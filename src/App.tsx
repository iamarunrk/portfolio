import { TitleFrame } from './hero/TitleFrame';
import { GizmoOverlay } from './overlay/GizmoOverlay';
import { Stage } from './scene/Stage';
import { Hint } from './ui/Hint';
import { Island } from './ui/Island';
import { TopBar } from './ui/TopBar';

export default function App() {
  return (
    <main className="app">
      <Stage />
      <TitleFrame />
      <GizmoOverlay />
      <TopBar />
      <Island />
      <Hint />
    </main>
  );
}
