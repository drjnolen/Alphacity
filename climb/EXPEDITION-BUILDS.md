# Expedition doctrine and field overclocks

Open **Expedition doctrine** beneath the operative portrait. Launching a climb opens it automatically. Each class has eight talents across two connected branches. Spend insight between encounters; inspect the build during combat. There is no respec within a climb.

Start with one insight and earn one from each of the first eight district bosses. Nodes cost 1, 1, 2, and 3 insight, with the preceding node required. A full branch costs seven, leaving two for the other branch's opening combination. Alternatively, take both branches through their third nodes and forgo the capstone. Points can be banked rather than spent immediately.

| Class | Branch | Decisions and combinations |
| --- | --- | --- |
| Glitchborn | Ghostrunner | Reposition before attacking, finish an enemy to recover an action, and isolate a Ghost Step target for guard. Kills can accelerate signature recovery. |
| Glitchborn | Saboteur | Apply corruption with any weapon, then choose whether to let it tick or consume it with Ghost Step. Hitting existing corruption suppresses attacks; killing in a cluster spreads corruption. |
| Chainbreaker | Inductor | Brace, then consume defense for a stronger hit, or retain it to absorb incoming damage. Full absorption earns a fourth AP; absorbed damage can charge a later attack. |
| Chainbreaker | Rupture | Set up slowed targets and clustered enemies. Redline and Unshackled reward fighting below half health, at the cost of weaker Brace and slower signature recovery. |
| Nodewalker | Signal architect | Suppress before using Fork Bomb. Trade primary damage for wider splash; the capstone turns that splash into suppression. |
| Nodewalker | Clocksmith | Move out of reach for guard. Bank an AP for faster recovery or spend three on Overdrive. The capstone links signature and gear cooldowns. |
| Coinbroker | Acquisitions | Mark with basic attacks, then spend credits on stronger signatures. Gear rebates are capped. Marked-target signatures can also grant guard and recover faster. |
| Coinbroker | Underwriter | Cash reserves strengthen Brace; low reserves strengthen attacks. Damage insurance is capped, and the once-per-encounter bailout costs credits if available. |

Primary-hit bonuses affect the selected target. Splash and corruption do not recursively trigger action refunds, weapon payouts, kill healing, or contagion. Kill refunds, movement guard, brace conversions, and cooldown links have per-round limits. Rebates pay at most 18 credits per encounter and damage insurance at most 24. Counterweight stores at most eight damage and does not stack. These limits avoid infinite AP, cooldown, or credit loops.

## Equipment choices

Each boss before the finale selects one equipped slot. Choose calibration, an active ability, or a passive circuit for the same existing price (60 + 20 × district in unsecured credits), or keep the credits. The selected slot persists across reloads. Calibration can repeat; each active and passive unlock can be installed once per slot. Already installed choices are visibly unavailable.

| Slot | Active (1 AP) | Cooldown | Passive |
| --- | --- | --- | --- |
| Weapon | Breach strike: 75% signature damage, armor piercing, basic range +1; pushes one connected tile or deals +3 collision damage. Applies equipped weapon affixes. | 3 rounds | +3 primary damage against targets at half health or less. |
| Tool | Signal snare: slow and suppress one target within four tiles; gain 3 guard. | 3 rounds | First movement each round grants 3 guard. |
| Charm | Reserve battery: gain guard and reduce signature cooldown by one. | 4 rounds | First primary-hit kill each encounter heals 4. |
| Cranial | Predictive breach: expose one target for bonus damage on the next primary hit this round; suppress its next attack. | 3 rounds | First signature each encounter deals +4 primary damage. |
| Chassis | Discharge: consume stored guard for armor-piercing damage within two tiles. | 3 rounds | Carry up to 3 unused guard between rounds. |

Reserve battery grants 7 + mastery level guard. Exposure is 4 + floor((mastery level − 1)/2) bonus damage. Discharge consumes up to 8 + 2 × mastery level guard, then deals the consumed amount +3. The interface displays current values. Cooldowns decrease at the end of enemy turns. Existing signature lockout also prevents gear abilities, and neither a battery nor a cooldown talent removes lockout.

Unlocks are attached to the equipped slot for this expedition; the existing climb already locks its physical loadout. Equip up to three gear actives alongside the signature in the doctrine panel. A fourth unlock stays available there for a later swap. Passive circuits apply without occupying an active slot. Pushes respect voids, stairs, obstacles, and occupied tiles; previously announced attacks remain fixed.

## Persistence and validation

Insight, learned talents, installed overclocks, active selections, and combat cooldowns carry across districts and browser saves. Death or final liberation clears them without changing permanent inventory or mastery. Existing active saves gain the appropriate available insight, keep their battlefield, and retain pending overclock offers. Migration filters unknown/foreign talents, invalid prerequisites, duplicate unlocks, and over-budget builds.

The game transition validates learning, purchases, loadout changes, targeting, AP, cooldowns, and resource costs. The presentation uses the resulting combat state for effects and deterministic non-critical target previews. No wallet, hosting, minting, or NFT transaction behavior changes.

Validation includes interaction and resource-cap tests, save migration, death/completion resets, all five gear abilities, critical hits, mobile/desktop UI review, and eight complete nine-district specialization campaigns using starter equipment and earned progression. These deterministic simulations establish viability and regressions; live-player balance can be tuned further from play feedback.
