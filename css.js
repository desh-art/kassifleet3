css
:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
  color: #182230;
  background: #f5f7fa;
  font-synthesis: none;
  --green: #12805c;
  --dark: #101828;
  --muted: #667085;
  --border: #e4e7ec;
}
* { box-sizing: border-box; }
body { margin: 0; }
a { color: inherit; text-decoration: none; }
.topbar {
  background: white;
  border-bottom: 1px solid var(--border);
  padding: 16px max(20px, calc((100% - 1050px)/2));
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand { font-size: 24px; font-weight: 850; letter-spacing: -1px; }
.brand span { color: var(--green); }
.container { max-width: 1050px; padding: 24px 18px 60px; margin: auto; }
.hero {
  color: white; background: var(--dark);
  padding: clamp(28px, 6vw, 60px); border-radius: 24px;
  margin-bottom: 22px;
}
.hero h1 { font-size: clamp(30px, 5vw, 48px); line-height: 1.1; max-width: 620px; }
.eyebrow { color: #75e0b1; font-weight: 750; font-size: 12px; letter-spacing: 2px; }
.panel {
  background: white; padding: 24px; border: 1px solid var(--border);
  border-radius: 18px; margin-bottom: 20px;
}
h2 { margin-top: 0; }
form { display: grid; gap: 14px; }
label { display: grid; gap: 7px; font-size: 14px; font-weight: 650; }
input, select, textarea {
  width: 100%; min-width: 0; padding: 12px 13px;
  border: 1px solid #d0d5dd; border-radius: 10px;
  font: inherit; background: white;
}
button {
  border: 0; border-radius: 10px; padding: 13px 18px;
  font: inherit; font-weight: 750; color: white;
  background: var(--green); cursor: pointer;
}
button:hover { filter: brightness(.94); }
button:disabled { opacity: .55; cursor: not-allowed; }
button.secondary { background: #e7f5ee; color: #116448; }
.menu-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px; margin: 16px 0;
}
.menu-item {
  border: 1px solid var(--border); border-radius: 14px; padding: 16px;
}
.menu-item p, .muted { color: var(--muted); font-size: 14px; }
.menu-item button { width: 100%; margin-top: 8px; }
#message { color: var(--green); overflow-wrap: anywhere; }
.status { padding: 5px 10px; border-radius: 99px; background: #e7f5ee; }
@media (max-width: 520px) {
  .container { padding: 16px 12px 40px; }
  .panel { padding: 18px; }
}