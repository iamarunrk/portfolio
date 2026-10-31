import { TitleFrame } from './hero/TitleFrame';
import { GizmoOverlay } from './overlay/GizmoOverlay';
import { Stage } from './scene/Stage';

export default function App() {
  return (
    <main className="app">
      <Stage />
      <TitleFrame />
      <GizmoOverlay />
    </main>
  );
}
