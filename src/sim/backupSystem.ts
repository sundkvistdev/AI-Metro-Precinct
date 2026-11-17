import * as THREE from 'three';
import { EngineConfigAsset } from '../assets/assetTypes';
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
  config: EngineConfigAsset,
  nailMatsGroup: THREE.Group,
  backupMode: BackupMode,
  drivingMode: DrivingMode,
  audio: JsonAudioSynth | null,
): void {
  if (!crime.suspectAlive) return;

  const policy = config.backupPolicies[backupMode];
  const effectiveDriving = policy.forceAggressive ? DrivingMode.Aggressive : drivingMode;

  const counts = getCrimeUnitCounts(crime, units, nailMats);
  const primary = crime.assignedUnitId
    ? units.find((u) => u.id === crime.assignedUnitId)
    : undefined;

  if (!primary || primary.status === UnitStatus.Retreating) {
    if (
      dispatchNearestUnit(
        crime,
        units,
        roadGraph,
        config,
        effectiveDriving,
        audio,
        false,
        false,
      )
    ) {
      return;
    }
  }

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

  const prolonged = crime.inVehiclePursuit
    ? crime.engagedSec > policy.prolongedPursuitSec &&
      crime.vehicleHp > 50 &&
      crime.vehiclePinnedTimer <= 0.1
    : crime.engagedSec > policy.prolongedFootSec && crime.suspectHp > 45;

  let shouldCallRegularBackup = false;
  if (counts.regularCount === 0) {
    shouldCallRegularBackup = true;
  } else if (counts.regularCount < policy.maxRegularUnits) {
    if (backupMode === BackupMode.Minimal) {
      shouldCallRegularBackup =
        downedTotal > 0 || (primary?.immobilized ?? false) || retreatingUnits > 0;
    } else if (backupMode === BackupMode.Standard) {
      shouldCallRegularBackup = primaryUnderDuress || prolonged;
    } else {
      shouldCallRegularBackup = crime.elapsedSec > policy.regularDelaySec;
    }
  }

  if (shouldCallRegularBackup) {
    if (
      crime.inVehiclePursuit &&
      counts.activeNailMats < policy.maxConcurrentNailMats &&
      crime.nailMatAttempts < policy.maxNailMatAttempts
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
          config,
          nailMatsGroup,
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
        config,
        effectiveDriving,
        audio,
        true,
        false,
      )
    ) {
      crime.backupDispatched = true;
    }
  }

  if (
    crime.inVehiclePursuit &&
    policy.maxConcurrentNailMats > 0 &&
    crime.elapsedSec > Math.max(1.2, policy.prolongedPursuitSec) &&
    counts.activeNailMats < policy.maxConcurrentNailMats &&
    crime.nailMatAttempts < policy.maxNailMatAttempts
  ) {
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
        config,
        nailMatsGroup,
        audio,
      );
    }
  }

  let triggerHeavy = false;
  if (backupMode === BackupMode.Minimal) {
    triggerHeavy = downedTotal > 0;
  } else if (backupMode === BackupMode.Standard) {
    triggerHeavy =
      downedTotal > 0 ||
      retreatingUnits > 0 ||
      fleeingOrCriticalTotal >= 2 ||
      (!crime.inVehiclePursuit &&
        crime.engagedSec > policy.heavyDelaySec &&
        crime.suspectHp > 35);
  } else if (backupMode === BackupMode.Perimeter) {
    const anyInjured = units.some(
      (u) => u.targetCrimeId === crime.id && u.officers.some((o) => o.hp < 75),
    );
    triggerHeavy =
      downedTotal > 0 ||
      retreatingUnits > 0 ||
      anyInjured ||
      (crime.suspectWeaponKind === 'rifle' && crime.elapsedSec > 7.5) ||
      crime.engagedSec > policy.heavyDelaySec;
  } else {
    triggerHeavy =
      (counts.heavyCount === 0 && crime.elapsedSec > policy.heavyDelaySec) ||
      (counts.heavyCount === 1 && crime.elapsedSec > policy.heavyDelaySec * 2.2);
  }

  if (triggerHeavy && counts.heavyCount < policy.maxHeavyUnits) {
    const preferKind = !counts.vanDeployed ? 'van' : 'apc';
    const heavyUnit = findStandbyUnit(units, crime, true, preferKind);
    if (
      heavyUnit &&
      dispatchNearestUnit(
        crime,
        units,
        roadGraph,
        config,
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
  config: EngineConfigAsset,
  drivingMode: DrivingMode,
  audio: JsonAudioSynth | null,
): boolean {
  if (!crime.suspectAlive) return false;
  const standbyReg = findStandbyUnit(units, crime, false);
  if (
    standbyReg &&
    dispatchNearestUnit(
      crime,
      units,
      roadGraph,
      config,
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
      config,
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
  config: EngineConfigAsset,
  nailMatsGroup: THREE.Group,
  audio: JsonAudioSynth | null,
): boolean {
  if (!crime.suspectAlive || !crime.inVehiclePursuit) return false;

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
    config,
    nailMatsGroup,
    audio,
  );
  if (ok) {
    crime.backupDispatched = true;
  }
  return ok;
}
