import React from 'react';
import { ControlDock, ControlDockProps } from './ControlDock';
import { TopStatusHud } from './TopStatusHud';

export type SimHudProps = ControlDockProps;

export const SimHud: React.FC<SimHudProps> = (props) => {
  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-5">
      <TopStatusHud snapshot={props.snapshot} />
      <ControlDock {...props} />
    </div>
  );
};
