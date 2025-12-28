import React from 'react'
import { useStore } from '@nanostores/react'
import { $counter, $settings } from '@shared/stores'

export function App() {
  const counter = useStore($counter)
  const settings = useStore($settings)

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h2>NanoStore IPC Bridge Demo</h2>
      <p>
        Opened as two windows. Changes should sync instantly across both.
      </p>

      <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <h3>Shared Counter</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => $counter.set(counter - 1)}>-</button>
          <div style={{ minWidth: 60, textAlign: 'center', fontSize: 18 }}>{counter}</div>
          <button onClick={() => $counter.set(counter + 1)}>+</button>
          <button onClick={() => $counter.set(0)} style={{ marginLeft: 8 }}>Reset</button>
        </div>
      </section>

      <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Shared Settings</h3>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <div>Theme:</div>
          <strong>{settings.theme}</strong>
          <button
            onClick={() =>
              $settings.set({
                ...settings,
                theme: settings.theme === 'dark' ? 'light' : 'dark'
              })
            }
          >
            Toggle
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ width: 60 }}>Hotkey:</div>
          <input
            value={settings.hotkey}
            onChange={(e) => $settings.set({ ...settings, hotkey: e.target.value })}
            style={{ flex: 1 }}
          />
        </div>
      </section>

      <hr style={{ margin: '16px 0' }} />

      <details>
        <summary>What to try</summary>
        <ul>
          <li>Change counter in Window A — Window B updates.</li>
          <li>Toggle theme in Window B — Window A updates.</li>
          <li>Edit hotkey string in either window — syncs as you type.</li>
        </ul>
      </details>
    </div>
  )
}
