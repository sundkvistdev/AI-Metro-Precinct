import React, { useState } from 'react';
import {
  Camera,
  Car,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Gauge,
  HelpCircle,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { CameraMode, SimSnapshot } from '../sim/types';
import { HudEditableFrame } from './HudEditableFrame';

export interface BottomControlBarProps {
  snapshot: SimSnapshot;
  onSetCameraMode: (mode: CameraMode) => void;
  onResetCamera: () => void;
  onToggleSimSpeed: () => void;
  onToggleAudio: () => void;
  onTriggerCrime: () => void;
  onTriggerPursuit: () => void;
}

const CAMERA_BUTTONS: Array<{ mode: CameraMode; label: string; keyHint: string }> = [
  { mode: CameraMode.Overview, label: 'Overview', keyHint: '1' },
  { mode: CameraMode.FreeFly, label: 'Free Fly', keyHint: '2' },
  { mode: CameraMode.FollowUnit, label: 'Follow', keyHint: '3' },
  { mode: CameraMode.RearLightbar, label: 'Lightbar', keyHint: '4' },
];

export const BottomControlBar: React.FC<BottomControlBarProps> = ({
  snapshot,
  onSetCameraMode,
  onResetCamera,
  onToggleSimSpeed,
  onToggleAudio,
  onTriggerCrime,
  onTriggerPursuit,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <HudEditableFrame
      widgetId="cameraBar"
      label="Camera & Quick Controls"
      allowWidthResize={false}
      allowHeightResize={false}
      zIndex={25}
    >
      <div className="pointer-events-none flex flex-col items-center gap-1">
        {helpOpen && !collapsed && (
          <div className="pointer-events-auto ui-panel px-3 py-2 text-[11px] text-zinc-200 shadow-xl w-[min(460px,92vw)]">
            <div className="flex items-center justify-between border-b border-zinc-600 pb-1 mb-1.5">
              <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-zinc-100">
                Viewport & Simulation Controls
              </span>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="border border-zinc-500 bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono-tabular text-[10px] text-zinc-300">
              <span>WASD / Arrows: Pan / Move</span>
              <span>Q / E: Orbit / Rotate Yaw</span>
              <span>R / F: Raise / Lower Altitude</span>
              <span>Z / X / Wheel: Zoom</span>
              <span>1 / 2 / 3 / 4: Camera Modes</span>
              <span>0: Reset Overview Camera</span>
              <span>Space: Trigger Crime Call</span>
              <span>H: Toggle Sidebar Panels</span>
            </div>
          </div>
        )}

        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="pointer-events-auto ui-panel flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 cursor-pointer whitespace-nowrap shrink-0 rounded-none shadow-lg"
          >
            <ChevronUp className="h-3.5 w-3.5" />
            Controls
          </button>
        ) : (
          <div className="pointer-events-auto ui-panel flex items-center gap-1 px-1.5 py-1 shadow-xl">
            <div className="flex items-center gap-0.5 border-r border-zinc-600 pr-1.5">
              <Camera className="h-3.5 w-3.5 text-zinc-400 mr-0.5 shrink-0" />
              {CAMERA_BUTTONS.map((item) => {
                const active = snapshot.cameraMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => onSetCameraMode(item.mode)}
                    title={`${item.label} (${item.keyHint})`}
                    className={`border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer rounded-none transition-colors ${
                      active
                        ? 'border-sky-400 bg-sky-600 text-white'
                        : 'border-zinc-600 bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
                    }`}
                  >
                    {item.label}
                    <span className="ml-1 font-mono-tabular text-[9px] opacity-75">
                      {item.keyHint}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onResetCamera}
                title="Reset Camera (0)"
                className="flex items-center gap-1 border border-zinc-600 bg-zinc-700/80 px-1.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-600 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
            </div>

            <div className="flex items-center gap-1 border-r border-zinc-600 pr-1.5">
              <button
                type="button"
                onClick={onToggleSimSpeed}
                title="Toggle Simulation Speed"
                className={`flex items-center gap-1 border px-2 py-1 text-[11px] font-mono-tabular font-medium whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
                  snapshot.simSpeed === 2
                    ? 'border-amber-400 bg-amber-600 text-white'
                    : 'border-zinc-600 bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
                }`}
              >
                <Gauge className="h-3.5 w-3.5" />
                {snapshot.simSpeed}x
              </button>

              <button
                type="button"
                onClick={onToggleAudio}
                title={snapshot.audioEnabled ? 'Mute Audio' : 'Unmute Audio'}
                className={`flex items-center gap-1 border px-2 py-1 text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer rounded-none ${
                  snapshot.audioEnabled
                    ? 'border-zinc-600 bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
                    : 'border-amber-500/70 bg-amber-700/40 text-amber-200 hover:bg-amber-600/60'
                }`}
              >
                {snapshot.audioEnabled ? (
                  <Volume2 className="h-3.5 w-3.5" />
                ) : (
                  <VolumeX className="h-3.5 w-3.5" />
                )}
                {snapshot.audioEnabled ? 'Audio' : 'Muted'}
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onTriggerCrime}
                title="Dispatch Foot Crime (Space)"
                className="flex items-center gap-1 border border-red-400/70 bg-red-600/85 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-500 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
              >
                <Crosshair className="h-3.5 w-3.5" />
                Crime
              </button>
              <button
                type="button"
                onClick={onTriggerPursuit}
                title="Dispatch Vehicle Pursuit"
                className="flex items-center gap-1 border border-orange-400/70 bg-orange-600/85 px-2 py-1 text-[11px] font-semibold text-white hover:bg-orange-500 cursor-pointer whitespace-nowrap shrink-0 rounded-none"
              >
                <Car className="h-3.5 w-3.5" />
                Pursuit
              </button>

              <button
                type="button"
                onClick={() => setHelpOpen((prev) => !prev)}
                title="Keyboard Shortcuts"
                aria-label="Keyboard Shortcuts"
                className={`border p-1 cursor-pointer rounded-none ${
                  helpOpen
                    ? 'border-sky-400 bg-sky-600 text-white'
                    : 'border-zinc-600 bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600'
                }`}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setHelpOpen(false);
                  setCollapsed(true);
                }}
                title="Minimize Bottom Control Bar"
                aria-label="Minimize Bottom Control Bar"
                className="border border-zinc-600 bg-zinc-700/80 p-1 text-zinc-200 hover:bg-zinc-600 cursor-pointer rounded-none"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </HudEditableFrame>
  );
};
