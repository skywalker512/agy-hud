import './styles/app.css';
import { render } from 'preact';
import { App } from './app';

const root = document.getElementById('app')!;
root.replaceChildren();
render(<App />, root);
