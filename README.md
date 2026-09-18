# Inazuma Clone — Prototipo

Esqueleto de un juego de fútbol PvP en tiempo real, estilo Inazuma Eleven,
jugable desde navegador (móvil y escritorio), controlado con el puntero
(ratón o dedo), y con conexión **P2P** entre los dos jugadores (sin servidor
propio) usando [Trystero](https://github.com/dmotz/trystero) sobre WebRTC.

## Cómo probarlo

```bash
npm install
npm run dev
```

Esto abre el juego en `http://localhost:5173`. Para probarlo entre dos
personas:

1. Abre esa URL, copia el `?room=XXXXX` que aparece en la barra de
   direcciones y compártelo con el otro jugador.
2. El otro jugador abre la misma URL completa (con el mismo `room=`).
3. En cuanto los dos navegadores se conectan por WebRTC, uno pasa a ser
   automáticamente el "host" (quien simula la física del partido) y el otro
   el "cliente" (quien solo envía su intención de movimiento). Esto lo
   decide el código solo, no hace falta que nadie lo elija.

También puedes probarlo tú solo abriendo la URL en dos pestañas o en el
ordenador + el móvil (usando la IP local, gracias a `host: true` en
`vite.config.js`).

## Cómo está organizado

- `src/main.js` — arranca Phaser y configura el motor de física (Matter.js).
- `src/scenes/GameScene.js` — el campo, los jugadores, la pelota, el control
  por puntero, y la lógica de quién simula qué (host vs cliente).
- `src/network/network.js` — la conexión P2P: sala compartida, elección de
  host, y los dos canales de mensajes (`input` y `state`).

## Cómo funciona la arquitectura de red (resumen)

- **Host**: ejecuta la física real (Matter.js), aplica los inputs de los dos
  jugadores, y ~20 veces por segundo difunde el estado resultante
  (posiciones de balón y jugadores) al rival.
- **Cliente**: no simula física propia, solo manda su input (hacia dónde
  quiere moverse) y dibuja lo que el host le dice, suavizando el movimiento
  por interpolación para que no se vea a saltos.
- Quién es host se decide comparando los IDs de los dos peers (el menor
  gana) — es determinista, así que los dos navegadores llegan siempre a la
  misma conclusión sin negociar nada explícitamente.

## Ahora sí: campo vertical, 11 jugadores por equipo, ritmo más lento

Cambio grande de arquitectura para acercarse más al juego original:

### Campo vertical
El campo ya no es apaisado — es vertical (480×760), con una portería
arriba y otra abajo, como en las capturas del juego de DS. `Scale.FIT` en
`main.js` sigue escalando esto a cualquier pantalla.

### 11 jugadores por equipo — pero solo controlas a uno cada vez
Igual que en el juego original: ves a tus 11 jugadores en el campo
colocados en formación (1-4-3-3), pero **solo controlas al que esté más
cerca del balón** en cada momento — el control salta solo de un jugador a
otro según se mueve el juego (con un pequeño margen para que no esté
parpadeando entre dos igual de cerca). Ese jugador activo lleva un
**contorno blanco** para que sepas siempre a quién estás moviendo.

- Los otros 10 de cada equipo se mueven solos manteniendo la formación
  (con un ligero desplazamiento hacia el lado del balón para no quedarse
  completamente estáticos).
- Los duelos de regate/entrada y los tiros/paradas siguen siendo 1 contra
  1, pero ahora entre **los dos jugadores activos** de cada equipo — los
  otros 20 jugadores en el campo son, de momento, "decorado táctico": dan
  la sensación de partido de 11 contra 11, pero no bloquean ni entran en
  combate. Ampliarlo a que cualquiera pueda entrar en un duelo sería el
  siguiente paso lógico, pero es un cambio grande aparte.
- Cada uno de los 11 titulares tiene sus propias estadísticas, técnicas,
  SP y cooldowns — no se comparten entre sí, así que da igual cuál esté
  activo en cada momento, cada uno lleva su propio "estado".
- El portero de cada equipo (el titular marcado como posición "GK") es
  quien defiende siempre los tiros a puerta, sea o no el jugador activo
  en ese momento.

### Ritmo más lento
Bajé la fuerza de movimiento (de 0.0025 a 0.0011) y añadí un tope de
velocidad máxima por jugador, así que ya no se nota tan "arcade" — cuesta
un poco más acelerar y llegar de un lado a otro del campo.

### Selección de equipo: ahora eliges 11, y ves lo que llevas
- Ya no eliges 1 titular — eliges **11**, tocando cada jugador de la lista
  para añadirlo a tu once (con un contador "Starters (X/11)"). El primer
  jugador con posición GK que añadas hará de portero.
- Arriba de la lista hay un **panel "tu equipo"** que se actualiza en
  vivo: ves los 11 que llevas y el banquillo, cada uno con una `×` para
  quitarlo sin tener que volver a buscarlo en la lista.
- El botón **"Confirm squad"** solo se activa con los 11 puestos llenos.
- Arreglé **"Use this whole team"**: ahora rellena directamente tus 11
  titulares (con portero primero si hay uno entre los resultados
  filtrados) más hasta 6 de banquillo, de una vez.
- Sobre "salen los juegos en lugar de los equipos": eso no es un fallo,
  es la limitación de datos que ya comentamos — ninguno de los dos Excel
  trae una columna de equipo real, así que el desplegable agrupa por
  **juego de origen** (IE1, GO2, VR...) a falta de esa información. En
  cuanto consigas los equipos reales, cambiamos ese desplegable sin tocar
  nada más.

### Sustituciones con 11 en el campo
Ahora el panel de cambios tiene dos pasos: primero eliges **a quién
sacas** de tus 11 titulares, luego **a quién metes** del banquillo. El
cambio es reversible (el que sale se va al banquillo, no desaparece).

## Roster real: 4986 jugadores, con técnicas de verdad (Hissatsu)

Me pasaste un segundo Excel (`Inazuma_Eleven_VR_Document_v3_06...`), mucho
más completo, y con esto **sustituyo del todo** el roster anterior (el de
9498 jugadores del primer Excel) — este es mejor en lo que más importaba:
las técnicas.

### Por qué es mejor
- Tiene una **hoja `Hissatsu` con 687 técnicas reales**: nombre, tipo
  (Shoot/Offense/Defense/Keep — mapeados a nuestras categorías
  shot/dribble/defense/keeper) y, sobre todo, **una potencia numérica ya
  calculada** (0-100) en vez de tener que inventármela a partir del coste.
  Ya no hace falta adivinar nada.
- La hoja `Characters` trae, por cada jugador, sus primeras 3 técnicas
  aprendidas — las cruzo por nombre contra la tabla de Hissatsu, y de
  **4986 jugadores, 4946 (99%) terminan con al menos una supertécnica**
  asignada (antes, con el otro Excel, la mayoría de GO se quedaban sin
  ninguna).
- Cubre 8 juegos, no solo 6: además de IE1/IE2/IE3/GO1/GO2/GO3, incluye
  **Ares no Tenbin** (`Ares`, 192 jugadores) y el propio juego móvil del
  que sale este Excel, **Victory Road** (`VR`, 854 jugadores).

### Cómo mapeé las estadísticas
Este juego usa 7 estadísticas por jugador (Kick, Control, Technique,
Pressure, Physical, Agility, Intelligence) en vez de las 7 clásicas de los
juegos de DS, así que las combiné así:
- `speed` ← Agility
- `shotPower` ← Kick
- `dribblePower` ← media de Control y Technique
- `defensePower` ← media de Pressure y Physical
- `keeperPower` ← media de Physical e Intelligence

Todas estas estadísticas en el Excel rondan 80-121 (una escala distinta a
los juegos originales), así que las normalizo dividiendo entre 95 en vez
de entre 60/100 como antes.

### Desglose por juego
IE1: 1016 · IE2: 638 · IE3: 622 · GO1: 894 · GO2: 397 · GO3: 373 ·
Ares: 192 · VR: 854.

### Limitación que queda
Cada jugador solo trae sus **primeras 3 técnicas aprendidas** en este
Excel (no las 4 completas), así que casi nunca tendrá las 4 categorías
rellenas a la vez — normalmente le faltará una. Sigue sin haber equipos
reales (mismo motivo que antes: la columna no existe en ninguno de los
dos Excel), así que el agrupador sigue siendo por juego.

## El juego ya está en inglés

Todo el texto que ve quien juega (HUD, marcador, panel de selección de
equipo, panel de duelo/tiro) está en inglés. Los comentarios del código
también los he pasado a inglés para que sea consistente si algún día lo
comparte o lo sube a un repo público en inglés.

## Limitaciones de este esqueleto (a mejorar)

- **Latencia del cliente**: el cliente no simula física propia, así que su
  jugador se siente con un pequeño retraso respecto al host. Client-side
  prediction (mover al instante en tu pantalla y reconciliar después)
  quitaría esto, pero no está hecho todavía.
- **Sin anti-cheat**: el host resuelve todo (posesión, duelos, tiros,
  fichajes/cambios), así que en teoría podría manipular su cliente. Vale
  para jugar con amigos o prototipar; si el juego se vuelve competitivo de
  verdad, hay que migrar esta misma lógica a un servidor real (por ejemplo
  con [Colyseus](https://colyseus.io/)).
- **Sin reconexión**: si el host cierra la pestaña, la partida se corta.
- **Solo los 2 jugadores activos "combaten"**: como se explica arriba, los
  otros 20 jugadores en el campo mantienen formación pero no bloquean ni
  entran en duelos — es decorado táctico, no una IA de equipo completa.
- **Si el rival se une justo después de que la IA ya haya empezado**: el
  partido arranca contra la IA con su equipo por defecto; el humano que se
  una después no tiene ocasión de elegir su propio equipo hasta la
  siguiente partida. Caso raro, pero lo dejo anotado.
- **Sin efectos visuales de las técnicas todavía**: la lógica del duelo/tiro
  ya funciona (SP, cooldown, probabilidad, resultado), pero no hay
  animación o destello específico por técnica.
- **Un ~1% de jugadores sin ninguna supertécnica**: cuando ninguna de sus
  3 técnicas conocidas aparece en la tabla Hissatsu con un tipo válido, se
  queda sin ninguna — le aparecerá siempre la opción normal en cualquier
  enfrentamiento.
- **Sin equipos reales todavía**: el selector agrupa por juego, no por
  equipo real (Raimon, Occult, etc.) porque el Excel no traía esa columna.
- **roster.json no se valida en el build**: si algún día lo reemplazas a
  mano y el JSON queda mal formado, la pantalla de selección de equipo
  fallará con un error visible en pantalla (lo capturo y lo muestro), pero
  no hay una comprobación automática antes de eso.

## Siguientes pasos sugeridos

1. Conseguir los equipos reales para agrupar el selector por equipo en
   vez de por juego (lo comentaste, en cuanto los tengas los metemos).
2. Que los 10 jugadores en formación también puedan entrar en duelos (no
   solo el activo) — acercaría mucho el partido a un 11 contra 11 real,
   pero es un cambio grande sobre lo que hay ahora.
3. Efectos visuales por técnica (destello de color, partícula al chutar,
   animación de parada).
4. Client-side prediction para el cliente (ver limitación arriba).
5. IA más avanzada: hoy es un conjunto de reglas simples; se podría variar
   la dificultad según las estadísticas del jugador rival, o añadir más
   variedad táctica (presión, contraataque...).
