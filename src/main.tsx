import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { start } from './state';

// Режим правки (таск 04): `src/editor/index.ts(x)` подключается сам, если есть,
// и регистрируется через `installEditor()` из `./state`.
import.meta.glob('./editor/index.{ts,tsx}', { eager: true });

start();
render(<App />, document.getElementById('app')!);
