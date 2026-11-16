import * as THREE from 'three';
import { JsonAudioSynth } from '../assets/jsonAudioSynth';
import { assignUnitToNailMat } from './nailMatSystem';
import { dispatchNearestUnit } from './policeUnitSystem';
import { TownRoadGraph } from './roadGraph';
import { ActiveCrime, NailMatActor, PoliceUnit } from './simActors';
import { BackupMode, DrivingMode, UnitStatus } from './types';

export interface CrimeUnitCounts {
  regularCount: number;
  heavyCount: number;
  vanDeployed: boolean;
  apcDeployed: boolean;
  activeNailMats: number;
}

export function getCrimeUnitCounts(
  crime: ActiveCrime,
  units: PoliceUnit[],
  nailMats: NailMatActor[],
): CrimeUnitCounts {
  let regularCount = 0;
  let heavyCount = 0;
  let vanDeployed = false;
  let apcDeployed = false;

  for (const u of units) {
    if (u.targetCrimeId !== crime.id || u.status === UnitStatus.Retreating) continue;
    if (u.isHeavyUnit) {
      heavyCount++;
      if (u.vehicleKind === 'van') vanDeployed = true;
      if (u.vehicleKind === 'apc') apcDeployed = true;
    } else {
      regularCount++;
    }
  }

  let activeNailMats = 0;
  for (const m of nailMats) {
    if (m.crimeId === crime.id && m.phase !== 'recovering') {
      activeNailMats++;
    }
  }

  return {
    regularCount,
    heavyCount,
    vanDeployed,
    apcDeployed,
    activeNailMats,
  };
}

function findStandbyUnit(
  units: PoliceUnit[],
  crime: ActiveCrime,
  allowHeavy: boolean,
  preferVehicleKind?: 'van' | 'apc',
): PoliceUnit | null {
  const candidates = units.filter(
    (u) =>
      (allowHeavy ? u.isHeavyUnit : !u.isHeavyUnit) &&
      !u.immobilized &&
      (u.status === UnitStatus.AtStation || u.status === UnitStatus.Returning) &&
      u.id !== crime.assignedUnitId &&
      u.targetCrimeId !== crime.id,
  );
  if (candidates.length === 0) return null;

  if (preferVehicleKind) {
    const preferred = candidates.find((c) => c.vehicleKind === preferVehicleKind);
    if (preferred) return preferred;
  }

  let best = candidates[0];
  let bestDist = best.pos.distanceToSquared(crime.pos);
  for (const c of candidates) {
    const d = c.pos.distanceToSquared(crime.pos);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

export function evaluateCrimeBackupPolicy(
  crime: ActiveCrime,
  units: PoliceUnit[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  scene: THREE.Scene,
  backupMode: BackupMode,
  drivingMode: DrivingMode,
  audio: JsonAudioSynth | null,
): void {
  if (!crime.suspectAlive) return;

  const effectiveDriving =
    backupMode === BackupMode.FullScale ? DrivingMode.Aggressive : drivingMode;

  const counts = getCrimeUnitCounts(crime, units, nailMats);
  const primary = crime.assignedUnitId
    ? units.find((u) => u.id === crime.assignedUnitId)
    : undefined;

  // Ensure a primary unit is always assigned when available
  if (!primary || primary.status === UnitStatus.Retreating) {
    if (
      dispatchNearestUnit(
        crime,
        units,
        roadGraph,
        effectiveDriving,
        audio,
        false,
        false,
      )
    ) {
      return;
    }
  }

  // Gather fleet-wide duress metrics
  let downedTotal = 0;
  let fleeingOrCriticalTotal = 0;
  let retreatingUnits = 0;
  let primaryUnderDuress = !primary || primary.status === UnitStatus.Retreating || primary.immobilized;

  for (const u of units) {
    if (u.status === UnitStatus.Retreating) retreatingUnits++;
    for (const o of u.officers) {
      if (o.hp <= 0) downedTotal++;
      if (o.cowardiceState === 'fleeing' || o.hp < 45) fleeingOrCriticalTotal++;
    }
  }

  if (primary) {
    if (
      primary.damageSmokeTimer > 0 ||
      primary.officers.some(
        (o) => o.hp <= 58 || o.ragdoll.active || o.cowardiceState === 'fleeing',
      )
    ) {
      primaryUnderDuress = true;
    }
  }

  // --- Regular Backup Policy ---
  let desiredRegularUnits = 1;
  let shouldCallRegularBackup = false;

  if (backupMode === BackupMode.Minimal) {
    desiredRegularUnits = primaryUnderDuress || retreatingUnits > 0 ? 1 : 1;
    shouldCallRegularBackup =
      counts.regularCount === 0 ||
      (counts.regularCount < 2 &&
        (downedTotal > 0 || (primary?.immobilized ?? false) || retreatingUnits > 0));
  } else if (backupMode === BackupMode.Standard) {
    desiredRegularUnits = 2;
    const prolonged = crime.inVehiclePursuit
      ? crime.engagedSec > 9.5 && crime.vehicleHp > 50 && crime.vehiclePinnedTimer <= 0.1
      : crime.engagedSec > 14.5 && crime.suspectHp > 45;
    shouldCallRegularBackup =
      counts.regularCount < desiredRegularUnits && (primaryUnderDuress || prolonged);
  } else if (backupMode === BackupMode.Perimeter) {
    desiredRegularUnits = 2;
    shouldCallRegularBackup =
      counts.regularCount < desiredRegularUnits && crime.elapsedSec > 1.8;
  } else {
    // FullScale (Code 99 Surge)
    desiredRegularUnits = 3;
    if (counts.regularCount < 2 && crime.elapsedSec > 0.6) {
      shouldCallRegularBackup = true;
    } else if (counts.regularCount < 3 && crime.elapsedSec > 2.2) {
      shouldCallRegularBackup = true;
    }
  }

  if (shouldCallRegularBackup) {
    // During an active pursuit, Standard/Perimeter/FullScale can route the incoming backup directly to deploy a nail mat ahead!
    const maxMats =
      backupMode === BackupMode.FullScale
        ? 2
        : backupMode === BackupMode.Perimeter || backupMode === BackupMode.Standard
        ? 1
        : 0;
    const maxAttempts =
      backupMode === BackupMode.FullScale
        ? 5
        : backupMode === BackupMode.Perimeter
        ? 3
        : 2;

    if (
      crime.inVehiclePursuit &&
      counts.activeNailMats < maxMats &&
      crime.nailMatAttempts < maxAttempts
    ) {
      const spikeUnit = findStandbyUnit(units, crime, false);
      if (
        spikeUnit &&
        assignUnitToNailMat(
          crime,
          spikeUnit,
          units,
          nailMats,
          roadGraph,
          scene,
          audio,
        )
      ) {
        crime.backupDispatched = true;
        return;
      }
    }

    if (
      dispatchNearestUnit(
        crime,
        units,
        roadGraph,
        effectiveDriving,
        audio,
        true,
        false,
      )
    ) {
      crime.backupDispatched = true;
    }
  }

  // --- Dedicated Nail-Mat Attempt by Secondary Pursuers (Perimeter / FullScale) ---
  if (
    crime.inVehiclePursuit &&
    crime.elapsedSec > 4.0 &&
    (backupMode === BackupMode.Perimeter || backupMode === BackupMode.FullScale)
  ) {
    const maxMats = backupMode === BackupMode.FullScale ? 2 : 1;
    const maxAttempts = backupMode === BackupMode.FullScale ? 5 : 3;
    if (counts.activeNailMats < maxMats && crime.nailMatAttempts < maxAttempts) {
      const candidate =
        findStandbyUnit(units, crime, false) ??
        units.find(
          (u) =>
            !u.isHeavyUnit &&
            u.targetCrimeId === crime.id &&
            u.id !== crime.assignedUnitId &&
            u.mounted &&
            !u.immobilized &&
            u.status === UnitStatus.Pursuing,
        ) ??
        null;

      if (candidate) {
        assignUnitToNailMat(
          crime,
          candidate,
          units,
          nailMats,
          roadGraph,
          scene,
          audio,
        );
      }
    }
  }

  // --- Heavy Tactical Escalation (SWAT 301 Van & APC 401) ---
  let desiredHeavyUnits = 0;
  let triggerHeavy = false;

  if (backupMode === BackupMode.Minimal) {
    desiredHeavyUnits = 1;
    triggerHeavy = downedTotal > 0;
  } else if (backupMode === BackupMode.Standard) {
    desiredHeavyUnits = 1;
    triggerHeavy =
      downedTotal > 0 ||
      retreatingUnits > 0 ||
      fleeingOrCriticalTotal >= 2 ||
      (!crime.inVehiclePursuit && crime.engagedSec > 24.0 && crime.suspectHp > 35);
  } else if (backupMode === BackupMode.Perimeter) {
    desiredHeavyUnits = 1;
    const anyInjured = units.some(
      (u) => u.targetCrimeId === crime.id && u.officers.some((o) => o.hp < 75),
    );
    triggerHeavy =
      downedTotal > 0 ||
      retreatingUnits > 0 ||
      anyInjured ||
      (crime.suspectWeaponKind === 'rifle' && crime.elapsedSec > 7.5) ||
      crime.engagedSec > 12.0;
  } else {
    // FullScale deploys both SWAT 301 Van AND APC 401
    desiredHeavyUnits = 2;
    triggerHeavy =
      (counts.heavyCount === 0 && crime.elapsedSec > 1.4) ||
      (counts.heavyCount === 1 && crime.elapsedSec > 3.2);
  }

  if (triggerHeavy && counts.heavyCount < desiredHeavyUnits) {
    // Prefer SWAT Van first, then APC 401 if Van is already deployed or unavailable
    const preferKind = !counts.vanDeployed ? 'van' : 'apc';
    const heavyUnit = findStandbyUnit(units, crime, true, preferKind);
    if (
      heavyUnit &&
      dispatchNearestUnit(
        crime,
        units,
        roadGraph,
        effectiveDriving,
        audio,
        true,
        true,
        heavyUnit.id,
      )
    ) {
      crime.heavyDeployed = true;
    }
  }
}

export function requestManualBackup(
  crime: ActiveCrime,
  units: PoliceUnit[],
  roadGraph: TownRoadGraph,
  drivingMode: DrivingMode,
  audio: JsonAudioSynth | null,
): boolean {
  if (!crime.suspectAlive) return false;
  // Prefer standby regular cruiser/SUV/van first, then SWAT Van, then APC
  const standbyReg = findStandbyUnit(units, crime, false);
  if (
    standbyReg &&
    dispatchNearestUnit(
      crime,
      units,
      roadGraph,
      drivingMode,
      audio,
      true,
      false,
      standbyReg.id,
    )
  ) {
    crime.backupDispatched = true;
    return true;
  }

  const standbyHeavy = findStandbyUnit(units, crime, true, 'van');
  if (
    standbyHeavy &&
    dispatchNearestUnit(
      crime,
      units,
      roadGraph,
      drivingMode,
      audio,
      true,
      true,
      standbyHeavy.id,
    )
  ) {
    crime.heavyDeployed = true;
    return true;
  }

  return false;
}

export function requestManualNailMat(
  crime: ActiveCrime,
  units: PoliceUnit[],
  nailMats: NailMatActor[],
  roadGraph: TownRoadGraph,
  scene: THREE.Scene,
  audio: JsonAudioSynth | null,
): boolean {
  if (!crime.suspectAlive || !crime.inVehiclePursuit) return false;

  // Prefer standby regular unit -> secondary pursuing regular unit -> standby heavy -> any mounted unit not already deploying spikes
  const candidate =
    findStandbyUnit(units, crime, false) ??
    units.find(
      (u) =>
        !u.isHeavyUnit &&
        u.targetCrimeId === crime.id &&
        u.id !== crime.assignedUnitId &&
        u.mounted &&
        !u.immobilized &&
        u.status === UnitStatus.Pursuing,
    ) ??
    findStandbyUnit(units, crime, true, 'van') ??
    units.find(
      (u) =>
        u.targetCrimeId === crime.id &&
        u.mounted &&
        !u.immobilized &&
        u.status === UnitStatus.Pursuing,
    ) ??
    null;

  if (!candidate) return false;
  const ok = assignUnitToNailMat(
    crime,
    candidate,
    units,
    nailMats,
    roadGraph,
    scene,
    audio,
  );
  if (ok) {
    crime.backupDispatched = true;
  }
  return ok;
}
