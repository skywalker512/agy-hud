import './styles/app.css';
import './styles/trend-chart.css';
import './styles/swarm-cockpit.css';
import { render } from 'preact';
import { App } from './app';

const root = document.getElementById('app')!;
root.replaceChildren();
render(<App />, root);
