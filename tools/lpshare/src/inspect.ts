import { SuiChain } from "./chain.ts";
import { defaults } from "./domain.ts";
const timer = setTimeout(() => {
  console.error("Read-only inspection timed out");
  process.exit(1);
}, 120000);
try {
  const chain = new SuiChain();
  console.log(JSON.stringify(await chain.inspect(defaults), null, 2));
  console.log(
    JSON.stringify(
      { claimSimulation: await chain.simulateClaim(defaults) },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(timer);
}
