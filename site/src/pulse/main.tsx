import { render } from 'preact';
import '../styles/main.css';
import { PulseApp } from './PulseApp';

const root = document.getElementById('app');
if (root) {
  render(<PulseApp />, root);
}
