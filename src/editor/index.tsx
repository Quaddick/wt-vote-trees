/**
 * Режим правки стримера. `src/main.tsx` подключает этот модуль сам (`import.meta.glob`);
 * здесь он регистрируется в странице через `installEditor`.
 */
import './editor.css';
import { installEditor } from '../state';
import { ChangeActions, Panel, Toolbar } from './components';
import { onCardClick } from './model';

installEditor({ onCardClick, Panel, Toolbar, ChangeActions });
