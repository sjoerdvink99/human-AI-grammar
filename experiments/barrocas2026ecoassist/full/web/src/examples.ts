import type { WebCode } from "../../shared/types.ts";

export const BLANK: WebCode = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>New page</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello</h1>
  <script src="script.js"></script>
</body>
</html>
`,
  css: `body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n}\n`,
  js: ``,
};

/** A hand-written page with several energy-intensive patterns, for trying the optimizer without generating. */
export const EXAMPLE: WebCode = {
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Clock dashboard</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Team dashboard</h1>
    <div id="clock" class="clock">--:--:--</div>
  </header>
  <main id="cards"></main>
  <script src="script.js"></script>
</body>
</html>
`,
  css: `body {
  font-family: system-ui, sans-serif;
  margin: 0;
  background: #f4f6fa;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  background: #2b6cb0;
  color: white;
}

.clock {
  font-size: 28px;
  position: relative;
  animation: pulse 0.6s infinite alternate;
}

@keyframes pulse {
  from { left: 0; box-shadow: 0 0 0 rgba(255, 255, 255, 0.2); }
  to { left: 6px; box-shadow: 0 0 30px rgba(255, 255, 255, 0.9); }
}

main {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
  padding: 24px;
}

.card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  will-change: transform, opacity;
}
`,
  js: `const clock = document.getElementById('clock');
const cards = document.getElementById('cards');

for (let i = 0; i < 300; i++) {
  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = '<h3>Metric ' + i + '</h3><p class="value">0</p>';
  cards.appendChild(c);
}

// update the clock as fast as possible
setInterval(function () {
  clock.textContent = new Date().toLocaleTimeString();
}, 1);

// keep card heights equal
function equalize() {
  const all = document.querySelectorAll('.card');
  for (let i = 0; i < all.length; i++) {
    const h = all[i].offsetHeight;
    all[i].style.minHeight = h + 'px';
  }
  requestAnimationFrame(equalize);
}
requestAnimationFrame(equalize);

window.addEventListener('scroll', function () {
  document.querySelectorAll('.card').forEach(function (c) {
    c.getBoundingClientRect();
  });
});
`,
};
