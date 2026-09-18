import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';

// Horizontal field on a wide/landscape screen (like a PC), vertical field
// on a narrow/portrait one (like a phone) — decided once at load time.
const horizontal = window.innerWidth > window.innerHeight;
const width = horizontal ? 760 : 480;
const height = horizontal ? 480 : 760;

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b3d1f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width,
    height
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: 0 },
      debug: false
    }
  },
  input: {
    activePointers: 2
  },
  scene: [GameScene]
};

new Phaser.Game(config);
