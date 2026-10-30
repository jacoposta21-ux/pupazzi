import './style.css';
import { GameManager } from './core/GameManager.js';

const game = new GameManager(document.getElementById('game'));
game.init();
if (import.meta.env.DEV) window.game = game;
