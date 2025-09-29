// server/server.js
import app from "./app.js";
import { PORT } from "./config/env.js";

app.listen(PORT, () => {
  console.log(`Sendo server listening on :${PORT}`);
});
