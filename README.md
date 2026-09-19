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

## Equipos reales, campo horizontal en PC, pases, PT numérico, formaciones

### Equipos reales — por fin
Me pasaste `Inazuma_Eleven_Manager_2026.xlsx`, con una hoja por equipo real
(Raimon, Royal, Umbrella, Occult, Wild...). Estaba desordenado como
avisaste, así que en vez de depender de columnas fijas (que cambian de
sitio según la hoja), busqué **anclas estructurales**: cada jugador de la
plantilla tiene una fila con su nombre justo antes de un bloque que
empieza por "Hissatsu", "Goalkeeping" o "Technical" — eso identifica de
forma fiable la fila de cada jugador sin importar en qué columna esté.
Cada nombre encontrado se valida contra nuestro roster ya existente (para
no colar nombres de entrenadores o "jugador favorito" que aparecen en
otras partes de la hoja).

Resultado: **976 jugadores del roster (de 4986) ahora tienen equipo real**,
de **49 equipos**, cada uno con sus **colores de camiseta reales** (hex,
sacados directamente de la sección "Kits" de cada hoja — no hizo falta
analizar ninguna imagen). Los ~4000 restantes se quedan sin equipo
asignado (este Excel de manager solo cubre esos 49 equipos concretos, no
los ~9500 personajes de todos los spin-offs).

`public/teams.json` guarda los colores de cada uno de los 49 equipos, y
cada jugador del roster tiene ahora `team` y `teamColor` (`null` si no se
encontró equipo para él).

### Sobre las fotos — seguimos sin tenerlas
Ni este Excel ni el anterior traen archivos de imagen de verdad, solo
texto (nombres, en este caso ni eso). Así que en vez de fotos, cada
jugador se distingue por su **color de camiseta real** (o un color fijo
por juego si no tiene equipo asignado) más sus **iniciales**, tanto en las
tarjetas de selección como en el campo. Si en algún momento consigues un
paquete real de imágenes (archivos, no rutas de texto), dímelo y lo
conectamos — el sitio donde iría está ya preparado (`avatarHtml()` en
`GameScene.js`).

### Campo horizontal en pantallas anchas
Al cargar la partida, si la ventana es más ancha que alta (como un
ordenador), el campo sale horizontal (porterías a izquierda y derecha);
si es más alta que ancha (como un móvil en vertical), sale vertical como
hasta ahora. Se decide una vez al cargar, no cambia si giras la pantalla
a mitad de partido.

### Pases: toca para pasar, arrastra para mover
- **Arrastrar** (mantener y mover el dedo/ratón) sigue dibujando el camino
  que seguirá el jugador, como hasta ahora.
- **Tocar sin arrastrar** (un toque rápido, sin apenas movimiento) ahora
  **pasa el balón** hacia ese punto, si el balón lo tienes tú — el balón
  sale disparado hacia ahí con física real, así que puede llegar a un
  compañero o no, según por dónde ruede.

### Puntos de técnica (PT): números, sin cooldown, por jugador
- Ya eran por jugador (cada uno de los 11 tiene los suyos), pero ahora
  además: **se muestran como número** ("PT: 62/100") en vez de barra, y
  **no hay cooldown** — solo importa si te quedan puntos suficientes. Si
  se agotan, simplemente no puedes usar esa supertécnica hasta que se
  regeneren un poco (se recuperan despacio con el tiempo, eso sí se
  mantiene).

### Formaciones: 4 para elegir, cambiable a mitad de partido
Antes de empezar eliges formación (4-4-2, 4-3-3, 4-2-3-1 o 3-5-2) en el
mismo desplegable de selección. Durante el partido hay un botón
**"Formation"** para cambiarla sobre la marcha (tus jugadores se
reposicionan poco a poco, no de golpe). Lo que **no** hice todavía es
dejarte mover manualmente a cada jugador dentro de la formación arrastrando
— por ahora son las 4 plantillas fijas; sería el siguiente paso si te
interesa.

### Banquillo de 5, y botón de aleatorio
El banquillo ahora tiene un tope real de 5 (antes dejaba más). Y hay un
botón **"🎲 Randomize squad"** que te arma un once + banquillo + formación
al azar de todo el roster (no solo del filtro actual), por si quieres
empezar a jugar rápido sin elegir uno a uno.

## Ahora sí: campo vertical, 11 jugadores por equipo, ritmo más lento, y más RPG

### El bug de las supertécnicas — encontrado y arreglado
Había dos fallos de verdad detrás de "no salen las supertécnicas":

1. **El cliente (el jugador que no aloja la partida) nunca construía su
   equipo en pantalla.** `startMatch()` — que crea los 11 cuerpos, sus
   estadísticas y sus técnicas — solo se llamaba en el host. El cliente se
   quedaba con `teamA`/`teamB` vacíos para siempre, así que cualquier
   consulta a sus estadísticas devolvía nada. Ahora hay una función
   equivalente (`buildClientTeams()`) que el cliente ejecuta en cuanto
   tiene los datos de las dos plantillas (las suyas y las del rival, que
   ya se intercambiaban, solo que no se usaban para esto).
2. **El "jugador activo" seguía recalculándose durante el propio duelo.**
   Si mientras elegías la acción el más cercano al balón cambiaba (podía
   pasar por inercia), el panel miraba las estadísticas del jugador nuevo
   en vez del que realmente estaba en el duelo — y si ese jugador nuevo no
   tenía técnica en esa categoría, el botón desaparecía. Ahora el panel
   siempre usa los IDs que se fijaron **en el momento exacto** en que
   empezó el enfrentami999, y el "jugador activo" deja de recalcularse
   mientras el juego está parado por un duelo/tiro.

### Ahora se ve quién gana el duelo
Al resolverse un enfrentamiento (duelo o tiro), sale un aviso en pantalla
un par de segundos ("Fulano se lleva el balón", "¡GOL! Mengano marca con
una supertécnica", "¡Parada! El portero la saca") — antes se resolvía en
silencio y no había forma de saber qué había pasado.

### Es más "pausa y decide" que tiempo real
- El movimiento (mover a los jugadores por el campo) sigue siendo en
  tiempo real, pero **mucho más lento** — da tiempo a pensar antes de que
  pase nada.
- En cuanto hay un duelo (dos jugadores activos chocan) o un tiro, **el
  juego se para de verdad**: nadie se mueve, y tienes hasta **20
  segundos** para elegir tu acción (antes eran 1,5s). El panel también
  muestra el nombre del jugador implicado y su SP actual.
- Se resuelve por estadísticas + probabilidad, no por reflejos — el
  tiempo real es solo para la parte de "colocar a tus jugadores".

### Las trayectorias ahora se ven, y puedes mover a varios jugadores a la vez
- El camino que dibujas con el dedo/ratón **se pinta en pantalla** (línea
  amarilla) mientras lo trazas y mientras tu jugador lo recorre.
- Como todo esto es "marcar intenciones" y no control directo en tiempo
  real, **puedes dibujar trayectorias para varios de tus 11 jugadores a
  la vez**: toca cerca de un jugador tuyo para "cogerlo" y trazarle su
  camino, suelta, toca cerca de otro jugador tuyo y haz lo mismo — cada
  uno sigue su propio camino de forma independiente.
- Si tocas en un sitio que no está cerca de ninguno de tus jugadores, por
  defecto se mueve el que esté más cerca del balón (el "activo").

### Duración del partido
Dos tiempos de 3 minutos cada uno (6 minutos en total), con un cambio de
parte automático a mitad (reposiciona a todos en formación) y un "Full
time" al acabar el segundo tiempo, que congela el partido. El marcador de
arriba ahora muestra también el reloj ("1st half — 2:45").

### Campo vertical
El campo ya no es apaisado — es vertical (480×760), con una portería
arriba y otra abajo, como en las capturas del juego de DS. `Scale.FIT` en
`main.js` sigue escalando esto a cualquier pantalla.

### 11 jugadores por equipo — pero solo "combate" el más cercano al balón
Ves a tus 11 jugadores en formación (1-4-3-3) en todo momento. El que
esté más cerca del balón en cada momento es el "activo" (marcado con un
contorno blanco) — es el único que puede coger el balón, entrar en un
duelo o tirar a puerta; los otros 10 mantienen la formación (con un ligero
desplazamiento hacia el lado del balón) pero no bloquean ni combaten
todavía. Cada uno de los 11 tiene sus propias estadísticas, técnicas, SP y
cooldowns — no se comparten entre sí. El portero de cada equipo (el
titular marcado como posición "GK") es quien defiende siempre los tiros a
puerta, sea o no el jugador activo en ese momento.

### Selección de equipo: eliges 11, y ves lo que llevas
- Eliges **11 titulares** tocando cada jugador de la lista (contador
  "Starters (X/11)"). El primer jugador con posición GK que añadas hace
  de portero.
- Panel **"tu equipo"** en vivo arriba de la lista: los 11 que llevas y el
  banquillo, cada uno quitable con una `×`.
- "Confirm squad" solo se activa con los 11 puestos llenos.
- **"Use this whole team"** arreglado: rellena tus 11 titulares (portero
  primero si hay uno entre los resultados filtrados) más hasta 6 de
  banquillo, de una vez.
- Sobre "salen los juegos en lugar de los equipos": sigue siendo la
  limitación de datos ya comentada (ningún Excel trae equipo real), no un
  fallo — el desplegable agrupa por juego de origen a falta de esa
  columna.

### Sustituciones con 11 en el campo
Panel en dos pasos: primero eliges a quién sacas de tus 11, luego a quién
metes del banquillo. Reversible (el que sale se va al banquillo). Ahora
además se mantiene sincronizado correctamente en el lado del cliente tras
un cambio (antes se quedaba con la alineación vieja si hacías más de una
sustitución).

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

## Estadísticas al nivel 99: nuevo Excel, más mecánicas de tiro

Me pasaste un PDF (`Inazuma_Eleven_level_99_stats.pdf`, una recopilación de
fan con las estadísticas al nivel máximo de miles de personajes, en tres
formatos de columnas distintos según la época) para que el roster reflejara
esos números en vez de los que ya había.

### Cómo lo procesé
El PDF no tiene tablas de verdad (es texto con columnas alineadas por
espacios, y a veces ni eso: dos técnicas seguidas quedan pegadas sin
espacio si sus columnas coinciden en ancho). Para no adivinar a ciegas:

1. Extraje las ~2841 filas válidas con un parser que detecta las 3
   variantes de columnas (7, 8 o 9 estadísticas según la página).
2. Para separar las 4 técnicas de cada jugador (a veces pegadas entre sí),
   monté un diccionario con los **526 nombres de técnica que ya existían**
   en el roster (con su categoría — shot/dribble/defense/keeper — ya
   correcta) y usé segmentación por diccionario (como separar palabras en
   un idioma sin espacios) para partir el texto por los nombres reales que
   reconocía. Cubrió el 74% de las técnicas directamente.
3. Para las técnicas que no reconocía, entrené un clasificador simple
   sobre qué palabras predicen cada categoría a partir de esos mismos 526
   nombres ya etiquetados (p.ej. "hand"/"catch"/"knuckle" → keeper,
   "slide"/"sumo"/"cyclone" → defense), con la posición del jugador como
   respaldo si ninguna palabra es concluyente.
4. Emparejé cada fila del PDF con el roster **por nombre**. De las 2841
   filas, 2169 encontraron jugador (algunos nombres del PDF son personajes
   inventados por el propio fan, esos los dejé fuera) — en total **1959
   jugadores del roster (de 4986) actualizados** con sus stats, técnicas,
   PT y condición física reales de este documento. El resto conserva lo
   que ya tenía.

### Qué cambió en cada jugador actualizado
- **Estadísticas de combate**: `shotPower` ← Kick, `dribblePower` ← media
  de Body/Control (o Dribbling/Technique en el formato más reciente),
  `defensePower` ← Guard/Block, `keeperPower` ← Guts/Catch, todas
  normalizadas de forma que la media siga rondando 1.0 (mismo criterio que
  las normalizaciones anteriores), aunque ahora el rango es algo más
  amplio (0.3–1.8) porque el nivel 99 trae más variedad real entre
  personajes.
- **4 técnicas por jugador**, no solo 1 por categoría: si dos de sus 4
  movimientos caen en la misma categoría, la de más potencia es la que se
  puede usar en el partido y la otra queda guardada en
  `techniquesExtra` (visible en los datos, no todavía en el panel de
  jugador) — así el dato está completo aunque el combate siga siendo 1
  supertécnica activa por categoría, como en los juegos originales.
- **PT (`maxSP`) es ahora una estadística real por jugador**, sacada de la
  columna TP del documento (antes todos tenían 100 fijo).
- **Condición física (`maxStamina`)**, sacada de la columna FP — nueva,
  alimenta el cansancio (ver debajo).

### Cansancio
Cada jugador tiene ahora una condición física que se agota a un ritmo fijo
durante todo el partido (da igual la mitad); solo el tamaño del depósito
cambia según su FP. Por debajo del 40% de su máximo, la velocidad empieza
a bajar suavemente hasta quedarse en un 55% cuando se vacía del todo. Un
cambio (sustitución) es la única forma de que un jugador salga con las
piernas frescas otra vez. Se ve un indicador nuevo junto al PT ("STA: x%",
en rojo si está bajo).

### El tiro pierde fuerza con la distancia
Un chute cerca del área sale a plena potencia; a partir de ahí la potencia
baja de forma progresiva hasta quedarse en un 45% a partir de los ~900px
(casi la longitud del campo). Un penalti nunca se ve afectado por esto
(siempre se tira desde el punto de penalti a la potencia que le
corresponda por la distancia real, sin límite artificial).

### Bloqueo de tiros lejanos
Si el tiro es "de lejos" (más de 320px) y hay un defensor rival plantado
cerca de la línea recta entre el tirador y la portería (no el portero —
él sigue siendo la última línea), antes de llegar al portero se dispara un
enfrentamiento de **bloqueo**: el defensor puede gastar PT en una
supertécnica de defensa para intentar frenarlo del todo. Si gana el
defensor, el balón queda suelto a sus pies y cambia la posesión. Si gana
el atacante, el tiro sigue su curso hacia el portero, pero con un 20% menos
de potencia todavía (ya iba debilitado por la distancia, y encima ha
rozado a un defensor) — se encadena automáticamente en el duelo normal de
tiro contra el portero, con su propia pantalla de VS.

### Limitación conocida
El PDF es una recopilación de fan, con calidad de datos variable —
personajes con formas "especiales"/evolucionadas (con nombres de técnica
muy estilizados, números romanos, kanji suelto...) a veces generan un
nombre de técnica algo deformado en los datos "no reconocidos" (por
ejemplo, un fragmento de nombre roto). Es un puñado de casos dentro de los
casi 4300 movimientos activos asignados — no afecta al equilibrio del
juego, como mucho al texto que se ve en el nombre de la técnica.

## Elegir también al rival, sprint al dibujar, PT/estamina en la tarjeta, y bloqueo solo con supertécnica

- **Selector de equipo rival**: en el editor de plantilla hay ahora dos
  pestañas, "Your Team" y "Rival Team". La del rival viene ya rellena al
  azar (misma selección por posición que el botón 🎲) y solo se usa si
  acabas jugando en solitario contra la IA — si se conecta un rival de
  verdad, siempre elige su propio equipo, se ignora lo que hayas puesto
  ahí. Se puede tocar tan poco o tanto como quieras: si dejas huecos, se
  rellenan solos al confirmar.
- **Sprint al dibujar una línea**: seguir un camino dibujado es una
  carrera decidida, así que ahora el jugador va un 35% más rápido (y
  acelera más rápido para llegar a esa velocidad) mientras sigue la línea,
  en vez de moverse al ritmo normal.
- **PT y estamina en la tarjeta del jugador**: la ficha que se abre al
  tocar dos veces un jugador (en la plantilla o en el panel de equipo
  durante el partido) muestra ahora también sus puntos de técnica y su
  condición física — como número actual/total si el jugador ya está en el
  campo durante un partido en marcha, o como su máximo antes de empezar.
- **El bloqueo de tiros ahora exige supertécnica**: un bloqueo "normal"
  nunca detiene el disparo — solo gastar PT en una técnica de defensa
  puede hacerlo. Si el defensor no tiene ninguna técnica de defensa
  asignada, o no le quedan PT para pagarla, la pantalla de bloqueo ni
  siquiera aparece (no hay nada que decidir) y el tiro sigue directo hacia
  el portero, ya debilitado por la distancia. Cuando sí puede intentarlo,
  el botón de "acción normal" desaparece del panel — solo se ofrece su
  supertécnica — para que quede claro que es la única opción real.

## Usar cualquier técnica repetida, bloqueo desde cerca, y opción de no hacer nada

- **Todas las técnicas de una categoría son usables, no solo la primera**:
  si un jugador tiene, por ejemplo, dos técnicas de tiro, ahora aparece un
  botón por cada una en el panel de confrontación (con su propio coste),
  en vez de solo la que quedó como "la" técnica de esa categoría — las
  demás vivían ya en los datos (`techniquesExtra`, ver la sección
  anterior) pero no se podían elegir. La ficha del jugador también lista
  ahora todas, no solo la primera de cada categoría.
- **El bloqueo se puede intentar a cualquier distancia**, incluso dentro
  del área — antes hacía falta que el tiro fuera "de lejos".
- **El jugador que bloquea puede decidir no hacer nada**: el botón de
  acción normal ya no desaparece del panel — pasa a llamarse "Let it
  through" y sigue sin poder detener el tiro él solo (eso solo lo hace una
  supertécnica), pero ahora es una decisión real en vez de una opción
  oculta: sirve para guardarse los PT si el jugador prefiere no arriesgar
  la técnica en ese momento.

## Sprint ligado a la estamina, reposicionar en directo, líneas que no se lían, media de jugador/equipo

- **El sprint al dibujar una línea ya no es tan bestia**, y encima baja con
  la estamina: a tope de condición física da un +18% de velocidad punta
  (antes +35%, demasiado), y ese extra se va reduciendo a medida que el
  jugador se cansa hasta desaparecer del todo con la estamina a cero — no
  es solo el tope de velocidad general el que baja con el cansancio, el
  propio impulso del sprint también.
- **Reposicionar jugadores en directo**: en el panel de equipo durante el
  partido, tocar dos jugadores del campo (en vez de uno del campo y otro
  del banquillo) intercambia sus posiciones — sin resetear su PT ni su
  condición física, porque a diferencia de un cambio, ninguno de los dos
  viene fresco del banquillo.
- **Arreglado el bug de la línea que hacía una V**: si tocabas para
  dibujar una línea sin acertar exactamente encima del jugador (o el toque
  no encontraba a nadie cerca y caía en el jugador activo, que podía estar
  lejos), el primer tramo de la línea salía desde el punto exacto donde
  tocaste en vez de desde donde estaba el jugador — así que primero corría
  hacia ese punto y luego volvía hacia donde realmente habías dibujado.
  Ahora la línea siempre arranca desde la posición real del jugador.
- **Las líneas que se dibujan solas ya no son líneas**: cuando el jugador
  agota tu línea dibujada y sigue corriendo por su cuenta hacia adelante
  (mientras el equipo tiene el balón), eso ya no se pinta como una línea
  amarilla — solo un puntito tenue en el destino, para que no se confunda
  con algo que tú mismo dibujaste.
- **Saque de centro dentro de tu campo**: al empezar el partido, tras un
  gol o en la segunda parte, los once de cada equipo se colocan ahora
  siempre dentro de su propia mitad — antes el sesgo que empuja a los
  jugadores hacia el balón durante el juego normal podía dejar a algún
  delantero un poco pasado de la línea de medio campo incluso en el saque.
- **Media de jugador y de equipo**: cada jugador tiene ahora una nota
  (30-99) calculada a partir de sus 5 estadísticas de combate, visible en
  su ficha y en las tarjetas del buscador de jugadores. El editor de
  plantilla también muestra la media del once que llevas armado ahora
  mismo, junto al contador de "X/11 filled".

## Jugadores repetidos diferenciados, y separar formación de la lista de jugadores

- **Sí había jugadores repetidos**: 157 nombres (349 fichas en total) aparecen
  más de una vez en el roster — el mismo personaje una vez por cada juego
  en el que salió (p.ej. Mark Evans en IE1 y en Ares), cada uno con sus
  propias estadísticas. Ya estaban incluidos como fichas independientes,
  pero como comparten el mismo equipo real ("Raimon", etc.) se veían
  idénticos en las tarjetas. Ahora, solo para los nombres repetidos, se
  añade el juego entre paréntesis ("Raimon (IE1)" / "Raimon (Ares)") para
  distinguirlos de un vistazo; el resto de jugadores (no repetidos) se ven
  igual que antes.
- **Separar la formación de la lista de jugadores**: el editor de plantilla
  tenía todo apilado en una sola pantalla larga. Ahora hay dos pestañas más
  ("📋 Formation" / "🔍 Browse Players") para enseñar solo el campo+banquillo
  o solo el buscador+lista, sin tener que hacer scroll de uno a otro.
  Funciona igual en la pestaña de "Your Team" y en la de "Rival Team".

## Nombres de jugador legibles en el campo

El texto bajo cada jugador tenía un borde negro de 3px sobre una letra de
solo 7px — casi tan grueso como la propia letra, así que se veía como un
borrón negro con un hilo blanco en medio. Ahora es blanco liso con una
sombra suave (en vez de un contorno duro), que da el contraste justo
contra el césped sin comerse el texto. También subí el tamaño de 7px a
9px para que se lean mejor de un vistazo.

## Sustituciones que a veces no se aplicaban

Mientras probaba el cambio anterior encontré un bug intermitente: pedir un
cambio de jugador (o mover a alguien de posición) durante el partido a
veces no hacía nada, sin ningún error visible. La petición se guardaba en
un flag de "una sola vez" que el bucle principal limpiaba cada frame, pero
solo se procesaba si en ese instante no había ningún enfrentamiento (duelo)
en curso en cualquier parte del campo — algo que puede empezar solo por
proximidad, sin que tenga nada que ver con la sustitución. Si el duelo
arrancaba justo en el frame en que tocaba aplicar el cambio, la petición se
perdía para siempre. Ahora las sustituciones y reposicionamientos se
procesan siempre, pase lo que pase con los enfrentamientos, así que ya no
se pierden.

## Velocidad general un 5% más baja, más dificultad de IA, y editor de plantilla combinado

- **Velocidad**: seguía pareciendo demasiado alta incluso después del ajuste
  del sprint, así que bajé el techo de velocidad general (afecta a todo el
  mundo por igual, con o sin sprint) otro 5% — de 0.72 a 0.684 para el
  jugador con el balón/objetivo activo, y de 0.66 a 0.627 para el movimiento
  automático sin balón.
- **Nivel de IA "Expert"**: se añade un cuarto nivel por encima de "Hard" que
  sigue la misma filosofía que los demás (decisiones más agudas, no más
  velocidad bruta) — usa supertécnicas con más frecuencia, dispara desde
  más lejos, tira el gatillo casi siempre que tiene ángulo y busca el pase
  algo más a menudo.
- **Editor de plantilla: campo y lista de jugadores a la vez**: las pestañas
  "📋 Formation" / "🔍 Browse Players" ya no son exclusivas — ahora son dos
  secciones independientes que se muestran las dos por defecto, y cada botón
  solo colapsa la suya si hace falta más sitio en pantalla. Con las dos
  visibles a la vez ahora se puede tocar un jugador de la lista y luego tocar
  directamente un puesto del campo (o del banquillo) para colocarlo ahí,
  esté ocupado o no — si el puesto ya tenía a alguien, ese jugador baja al
  banquillo (o se descarta de la plantilla si el banquillo ya está lleno).
  Un aviso junto al campo indica a quién se está colocando y permite
  cancelar la selección.

## Lista de jugadores: orden, y ficha completa con doble toque

- **Sort**: la lista de jugadores para elegir plantilla tiene ahora un
  desplegable de orden — Rating (por defecto), Nombre, Posición, o cada
  estadística de combate (Velocidad, Tiro, Regate, Defensa, Portero) de
  mayor a menor.
- **Las tarjetas de la lista funcionan igual que las fichas del campo**:
  antes, tocar un jugador ya fichado enseñaba sus estadísticas al momento
  (un solo toque), y tocar uno sin fichar lo colocaba directamente. Ahora
  cualquier tarjeta de la lista — esté ya en la plantilla o no — se
  selecciona con un toque (igual que un pin del campo o del banquillo), un
  segundo toque sobre la misma tarjeta enseña la ficha completa, y tocar
  una tarjeta distinta después la intercambia/coloca en consecuencia. Esto
  además permite intercambiar dos titulares directamente desde la lista,
  sin tener que buscarlos en el campo.

## Posesión tras gol, y algo más de separación en el saque de centro

- **Posesión tras gol**: al marcar, la posesión pasaba a "nadie" y se la
  quedaba quien tocara antes el balón en el saque — ahora se asigna
  explícitamente al equipo que ha encajado el gol, como marca la regla real
  del saque de centro.
- **Separación de la línea de medio campo**: en los saques (inicio,
  reinicio tras gol, segunda parte) los jugadores ya no pueden quedarse
  pegados o justo encima de la línea — se añade un margen fijo a cada lado.
