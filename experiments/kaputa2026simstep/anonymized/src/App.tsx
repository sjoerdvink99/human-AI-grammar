import { useEffect, useState } from 'react';
import { useStore } from './store';
import { DesignFlow } from './components/DesignFlow';
import { Workspace } from './components/Workspace';

export function App() {
  const s = useStore();
  const [tab, setTab] = useState<'design' | 'workspace'>(s.codeVersions.length ? 'workspace' : 'design');

  // When process 1 hands over to process 3, move to the workspace.
  useEffect(() => {
    if (s.stage === 'testing') setTab('workspace');
  }, [s.stage]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>System X</h1>
        <span className="sub">from a request to a working visualization program</span>
        <nav className="tabs">
          <button className={tab === 'design' ? 'active' : ''} onClick={() => setTab('design')}>
            1 · Design
          </button>
          <button className={tab === 'workspace' ? 'active' : ''} disabled={!s.codeVersions.length} onClick={() => setTab('workspace')}>
            2 · Workspace
          </button>
        </nav>
        <span className="spacer" />
        <button
          className="link"
          onClick={() => {
            if (confirm('Discard this session and start over?')) {
              s.reset();
              setTab('design');
            }
          }}
        >
          new session
        </button>
      </header>

      <div className={`statusbar ${s.busy ? 'busy' : ''} ${s.error ? 'has-error' : ''}`}>
        {s.busy ? (
          <>
            <span className="spinner" /> {s.busy}…
          </>
        ) : s.error ? (
          <>
            ⚠ {s.error}{' '}
            <button className="link" onClick={() => useStore.setState({ error: null })}>
              dismiss
            </button>
          </>
        ) : (
          <span className="muted">
            {s.log.length ? `Last step: ${s.log[s.log.length - 1].step}` : 'Ready.'}
          </span>
        )}
      </div>

      <main>{tab === 'design' ? <DesignFlow /> : <Workspace />}</main>
    </div>
  );
}
