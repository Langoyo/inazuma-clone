import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';

// The logical field is 960×1520. The canvas is always the viewport
// size (480×760) — the Phaser camera scrolls over the bigger world.
const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b3d1f',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 480,
    height: 760
  },
  physics: {
    default: 'matter',
    matter: { gravity: { y: 0 }, debug: false }
  },
  input: { activePointers: 2 },
  scene: [GameScene]
};

new Phaser.Game(config);
