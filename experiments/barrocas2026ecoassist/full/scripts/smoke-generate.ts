import { generateCode } from "../server/models.ts";
const c = await generateCode("A tiny counter app with + and - buttons", "haiku");
console.log(c.html.slice(0, 300)); console.log("css", c.css.length, "js", c.js.length);
