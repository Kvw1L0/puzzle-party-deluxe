# 🧩 Puzzle Party Deluxe

Una experiencia multijugador interactiva en tiempo real al estilo **Jackbox Games** y **Bachillerato Party**, diseñada para competir resolviendo puzzles deslizantes sincronizados en vivo.

Optimizado para ser desplegado en **Vercel** de forma gratuita y sincronizado en tiempo real mediante **Google Firebase Firestore**.

---

## 🏛️ Arquitectura de 3 Pantallas

1. **📺 Pantalla de TV Gigante (`/pantalla.html` o `/tv.html`)**: Diseñada para proyectores o Smart TVs. 
   - **Lobby Monumental (2 Columnas)**: Genera el código QR gigante en el cliente (`qrcode.min.js`) y el PIN de sala monumental con resplandor dorado.
   - **Comunidad en Vivo**: Visualiza los avatares y nombres de los participantes que se van uniendo en tiempo real.
   - **Transmisión de Partida**: Muestra el tablero del jugador destacado con actualizaciones en vivo, porcentaje de progreso, cronómetro sincronizado y tabla de clasificación.
   - **Celebración de Victoria**: Banner estrambótico animado y lluvia de confeti (`canvas-confetti`) cuando un participante completa su puzzle.

2. **📱 Pantalla del Jugador Móvil (`/` o `/index.html`)**: Interfaz táctil responsiva para teléfonos.
   - Detección y autocompletado automático de PIN al escanear el código QR.
   - Selector táctil de avatares con emojis dinámicos y feedback visual.
   - Tablero táctil deslizante con sonido háptico Web Audio, resaltado de fichas en posición correcta y vista rápida del patrón objetivo.
   - Modal de victoria con ráfagas de confeti y registro automático de puntuación.

3. **🎛️ Panel del Administrador (`/admin.html`)**: La cabina de control del presentador.
   - Generación de salas y PIN de 6 dígitos.
   - Apertura/cierre de sala, inicio sincronizado y reinicio global.
   - Selección de jugador destacado para proyectar en la pantalla gigante.
   - Configuración de modalidades: *Patrón de color*, *Números en orden*, *Memoria visual*, *Imagen personalizada PNG* y *Modo marca*.
   - Selector de grilla: 3×3 (8 fichas) o 4×4 (15 fichas).
   - Carga de imagen para el puzzle y fondo corporativo/temático para toda la experiencia.

---

## 🚀 Despliegue en Vercel & Firebase

1. **Firebase**:
   - Proyecto en Firebase con **Cloud Firestore** y **Authentication** (acceso anónimo habilitado para jugadores).
   - Configuración ubicada en `firebase.js`.

2. **Vercel**:
   - Proyecto estático listo para producción con `vercel.json` configurado para URLs limpias.

---

## 🛠️ Tecnologías

- **HTML5 & CSS3 moderno** (Tailwind CSS CDN + Google Fonts *Outfit*, *Plus Jakarta Sans*, *Bebas Neue*)
- **JavaScript Vanilla ES6+**
- **Google Firebase Firestore & Auth**
- **Canvas Confetti**
- **Lucide Icons**
- **QRCode.js** (generación local en cliente)
