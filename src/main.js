import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b3d1f',
  scale: {
    mode: Phaser.Scale.FIT, // scales the field to fit any screen
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 480,   // vertical field, like the original games
    height: 760
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: 0 }, // top-down view: no gravity
      debug: false
    }
  },
  input: {
    activePointers: 2 // basic multitouch support on mobile
  },
  scene: [GameScene]
};

new Phaser.Game(config);
