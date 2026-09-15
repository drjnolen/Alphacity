# Tactical pressure

New encounters build on the existing damage curve. Original units remain in each formation; relay encounters add a fragile support target. Behavior does not scale against the player's chosen build.

## Introduction across the climb

| District | New pressure |
| --- | --- |
| 1 onward | Enforcers can move two connected tiles and strike in one turn. Elite commanders and bosses enrage. |
| 2 onward | Ordinary snipers prepare interruptible charged attacks. |
| 3 onward | Encounters after the opening patrol add one Aegis relay. |
| 4 onward | Bosses also charge versions of their existing district attack patterns. |
| 5–9 | Relays become themed beacons that can summon one response enforcer after four enemy turns. |

## Rules and counterplay

**Move + strike.** Amber paths show the approach; red tiles show the fixed strike target. These are not two unrestricted attacks. Kinetic slow removes one movement step; occupied tiles and ledges block travel. Displacement cancels the approach. Enemies cannot retarget after the rebel moves. A blocker dying or moving during resolution cannot unlock an attack that was not shown before End turn.

**Charged attacks.** Every third round eligible units begin a one-turn windup with violet warning tiles. The following turn releases the same footprint for 125% of the planned attack (rounded up). Target and damage remain locked. Interrupt by dealing a net `8 + 2 × district` damage during the charge, jamming, displacing the enemy, or reaching 40% suppression. Corruption counts before enemy attacks resolve. An interrupt clears the attack and displays INTERRUPTED. The unit resumes its normal schedule afterward.

**Relay protection.** A relay grants four additional armor to allies within Manhattan distance two; it cannot shield itself. Links do not stack. Suppression progressively reduces protection, reaching zero at 25%; jam shuts it off. Status clears after the enemy turn using existing control durations. Kill the relay, push protected targets outside its radius, or use piercing attacks. A rebel on a connected adjacent tile can disable the relay for one AP. Disabling removes it without weapon hit effects or per-hit credits.

**Enrage.** At 50% and 25% remaining HP, commanders gain 20% and 40% of base enemy damage, respectively, while losing two and four intrinsic armor (minimum zero). Changes are announced at the next turn boundary. Existing boss phases remain active. Already charged damage stays locked during the player's response window. Reduced armor rewards a finishing attack; suppression, guard and interruption remain effective.

**Timed objectives.** Memory purge beacon, Privateer distress mast, Devotion broadcaster, Sentence uplink and Dynasty reinforcement beacon match districts 5–9. Jam or at least 25% suppression pauses the countdown. Destroying or disabling the beacon prevents the wave. Expiry adds exactly one response enforcer on a free reachable tile. It first acts on the following enemy turn after its intent is shown. A full board delays arrival rather than overlapping another unit. The beacon never summons a second wave, including after reload.

## Build interactions

- Glitchborn: Umbral ignores relay armor; corruption contributes to interruption. Mobility reaches relay controls or leaves fixed strike footprints.
- Chainbreaker: Kinetic slow can prevent melee contact. Breach strike interrupts through displacement when a legal destination exists. Enrage presents a finish-now versus preserve-guard decision.
- Nodewalker: Enertech weakens relay armor; 25% removes protection and pauses the clock, while 40% also interrupts charges. Signal snare reaches the interrupt threshold. Suppressing splash can affect several linked units.
- Coinbroker: signature jam cancels a charge and suspends a beacon. Siphon and credit talents retain their bounded payouts; disabling a relay produces no per-hit credit event.
- All factions can use damage, positioning, piercing signatures and unlocked gear abilities. Adjacent relay disabling supplies a control option without a matching weapon or overclock.

## Presentation and saves

The board shows amber movement paths, violet charge footprints, green armor links, relay countdowns and enrage labels. Enemy cards show damage and interruption thresholds; the objective panel explains its timer and provides the disable action. Combat effects use attacks actually resolved after movement, corruption, control and collision, avoiding phantom volleys.

Active older battles keep their saved behavior. Tactical rules begin in the next encounter. New saves preserve paths, charge progress, control state and objective receipts. Campaign resets still clear the run and preserve only minted equipment alongside the starter kit.

## Validation

Focused regressions cover movement and collision, no mid-turn retargeting, charge timing and control, live shield armor, enrage timing, one-wave objectives, action costs, gradual introduction, and save continuity. Campaign simulations exercise all eight specialization paths, all factions and starter equipment combinations with existing health and resource constraints. These check viability rather than establishing a human win-rate target.
