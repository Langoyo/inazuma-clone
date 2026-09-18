import Phaser from 'phaser';
import GameScene from './scenes/GameScene.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: '#0b3d1f',
  scale: {
    mode: Phaser.Scale.FIT, // escala el campo para que quepa en cualquier pantalla
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 500
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { y: 0 }, // vista cenital: sin gravedad
      debug: false
    }
  },
  input: {
    activePointers: 2 // permite gestos táctiles básicos en móvil
  },
  scene: [GameScene]
};

new Phaser.Game(config);
