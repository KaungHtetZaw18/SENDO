// server/server.js
import app from "./app.js";
import { PORT } from "./config/env.js";

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
