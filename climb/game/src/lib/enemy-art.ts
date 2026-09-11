import type { Enemy } from './game.ts';

/** Standalone cutouts: each named commander owns its image, including saved encounters. */
export const ENEMY_ART: Record<string, string> = {
 'Warrant Hound': 'warrant-hound',
 'The Debt Collector': 'debt-collector',
 'Compliance Titan': 'compliance-titan',
 'Censor Prime': 'censor-prime',
 'The Erasure Engine': 'erasure-engine',
 'Admiral Lockjaw': 'admiral-lockjaw',
 'The Bliss Curator': 'bliss-curator',
 'Judicator Zero': 'judicator-zero',
 'Sovereign Aurex': 'sovereign-aurex',
 'Elite Implant Militia': 'elite-implant-militia',
 'Elite Audit Drone': 'elite-audit-drone',
 'Elite Debt Enforcer': 'elite-debt-enforcer',
 'Elite Devotion Gunner': 'elite-devotion-gunner',
 'Elite Neural Nullifier': 'elite-neural-nullifier',
 'Elite Ledger Executioner': 'elite-ledger-executioner',
 'Elite Gilded Praetorian': 'elite-gilded-praetorian',
 'Elite Correction Surgeon': 'elite-correction-surgeon',
};

export function enemyArt(enemy?: Pick<Enemy, 'name'>): string | undefined {
 const asset = enemy && ENEMY_ART[enemy.name];
 return asset ? `/climb/assets/art/commanders/${asset}.png` : undefined;
}
