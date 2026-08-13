// App shell — renders the one real screen of the Walking Skeleton, the daily
// round. A FRESH build (NOT a strip of any prior 4761-line game shell —
// RESEARCH Pitfall 4). StorageAdapter.init() runs in main.tsx before mount, so
// the identity/round keys are primed before RoundScreen reads them.
import { Analytics } from '@vercel/analytics/react';
import RoundScreen from './RoundScreen';

export default function App() {
  return (
    <>
      <RoundScreen />
      <Analytics />
    </>
  );
}
