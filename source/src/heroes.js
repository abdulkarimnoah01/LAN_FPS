/* Hero roster definitions, lore dossiers, and tactical attributes for LAN_FPS operatives. */

export const HERO_ROSTER = {
  abdulkarim: {
    id: 'abdulkarim',
    name: 'Abdulkarim',
    title: 'Shadow Infiltrator',
    classType: 'INFILTRATOR',
    badge: '🗡',
    bio: 'Covert black-ops operative specializing in stealth flanking, suppressed weapon engagements, and high-damage silent melee strikes from behind enemy lines.',
    stats: { mobility: 95, durability: 65, precision: 80, firepower: 80 },
    skins: [
      { id: 'abdulkarim', name: 'Black Button-up' },
      { id: 'abdulkarim-blue', name: 'Blue Palm Shirt' }
    ],
    signatureWeapon: 'Combat Knife & SMG',
    signatureIcon: '🗡',
    trait: 'Shadow Step',
    traitDesc: '+15% sprint velocity with knife drawn & lethal backstabs',
    defaultColor: '#2b2b2b',
    swatches: [
      { name: 'Stealth Matte', color: '#2b2b2b' },
      { name: 'Crimson Ghost', color: '#dc2626' },
      { name: 'Cobalt Shadow', color: '#2563eb' },
      { name: 'Poison Dart', color: '#059669' },
      { name: 'Arctic Ghost', color: '#e2e8f0' }
    ]
  },
  mina: {
    id: 'mina',
    name: 'Mina',
    title: 'Long-Range Recon',
    classType: 'RECON',
    badge: '🎯',
    bio: 'World-class scout sniper providing perimeter surveillance and lethal long-range interdiction. Eliminates hostiles with pin-point optics before they close the distance.',
    stats: { mobility: 75, durability: 60, precision: 98, firepower: 92 },
    signatureWeapon: 'Sniper Rifle (.50 Cal)',
    signatureIcon: '🔭',
    trait: 'Eagle Eye',
    traitDesc: 'High optic magnification stability & lethal one-shot headshots',
    defaultColor: '#38bdf8',
    swatches: [
      { name: 'Recon Cyan', color: '#38bdf8' },
      { name: 'Red Spotter', color: '#f87171' },
      { name: 'Deep Horizon', color: '#1d4ed8' },
      { name: 'Forest Ghillie', color: '#047857' },
      { name: 'Dune Mirage', color: '#d97706' }
    ]
  },
  robot: {
    id: 'robot',
    name: 'Robot',
    title: 'Vanguard Mechanoid',
    classType: 'HEAVY SUPPORT',
    badge: '🛡',
    bio: 'Autonomous combat synthetic engineered with high-density ballistic chassis plating. Acts as an impenetrable anchor for team pushes and heavy suppressive fire.',
    stats: { mobility: 65, durability: 95, precision: 65, firepower: 95 },
    signatureWeapon: 'LMG & Auto Shotgun',
    signatureIcon: '⚙',
    trait: 'Ironclad Core',
    traitDesc: 'Heavy recoil dampening and explosion shock resistance',
    defaultColor: '#94a3b8',
    swatches: [
      { name: 'Titanium Steel', color: '#94a3b8' },
      { name: 'Hazard Red', color: '#ef4444' },
      { name: 'Industrial Blue', color: '#0284c7' },
      { name: 'Cyber Amber', color: '#eab308' },
      { name: 'Dark Alloy', color: '#1e293b' }
    ]
  },
  romero: {
    id: 'romero',
    name: 'Romero',
    title: 'Breacher Specialist',
    classType: 'BREACHER',
    badge: '💥',
    bio: 'Close-quarters shock trooper specializing in explosive room-clearing, point-blank shotgun sweeps, and barricade penetration.',
    stats: { mobility: 80, durability: 88, precision: 70, firepower: 92 },
    signatureWeapon: 'Shotgun & Frag Grenades',
    signatureIcon: '💣',
    trait: 'Blast Shielding',
    traitDesc: 'Reduced damage taken from grenade and barrel explosions',
    defaultColor: '#ea580c',
    swatches: [
      { name: 'Hazard Orange', color: '#ea580c' },
      { name: 'Firestorm Red', color: '#ef4444' },
      { name: 'Desert Khaki', color: '#d97706' },
      { name: 'Urban Ash', color: '#4b5563' },
      { name: 'Heavy Cobalt', color: '#2563eb' }
    ]
  },
  eldeep: {
    id: 'eldeep',
    name: 'ElDeep',
    title: 'Flanker & Pointman',
    classType: 'SKIRMISHER',
    badge: '⚡',
    bio: 'Hyper-agile skirmisher excelling at rapid combat maneuvering, unexpected angle rotations, and high-tempo SMG run-and-gun combat.',
    stats: { mobility: 98, durability: 68, precision: 78, firepower: 82 },
    signatureWeapon: 'SMG & Combat Knife',
    signatureIcon: '🗡',
    trait: 'Fleet-Footed',
    traitDesc: 'Accelerated sprint burst and rapid strafe transitions',
    defaultColor: '#0284c7',
    swatches: [
      { name: 'Sky Diver', color: '#0284c7' },
      { name: 'Electric Cyan', color: '#06b6d4' },
      { name: 'Midnight Navy', color: '#1e3a8a' },
      { name: 'Stealth Black', color: '#18181b' },
      { name: 'Flash Gold', color: '#eab308' }
    ]
  },
  gemy: {
    id: 'gemy',
    name: 'Gemy',
    title: 'Combat Sharpshooter',
    classType: 'MARKSMAN',
    badge: '🎯',
    bio: 'Tactical marksman adept at medium-to-long range interdiction, picking off key targets across ruins, bridges, and open lanes.',
    stats: { mobility: 78, durability: 72, precision: 95, firepower: 90 },
    signatureWeapon: 'Sniper Rifle & AK-47',
    signatureIcon: '🔭',
    trait: 'Deadshot',
    traitDesc: 'Pinpoint first-shot accuracy and extended ADS stability',
    defaultColor: '#16a34a',
    swatches: [
      { name: 'Sniper Olive', color: '#16a34a' },
      { name: 'Ghillie Forest', color: '#15803d' },
      { name: 'Camo Tan', color: '#ca8a04' },
      { name: 'Night Ops', color: '#334155' },
      { name: 'Bloodline', color: '#b91c1c' }
    ]
  },
  hamdy: {
    id: 'hamdy',
    name: 'Hamdy',
    title: 'Heavy Enforcer',
    classType: 'ENFORCER',
    badge: '🛡',
    bio: 'Frontline juggernaut who lays down continuous suppressive fire with high-capacity machine guns to pin down enemy squads.',
    stats: { mobility: 68, durability: 92, precision: 72, firepower: 96 },
    signatureWeapon: 'LMG (Drum Mag)',
    signatureIcon: '⚙',
    trait: 'Suppressor',
    traitDesc: 'Deep ammunition reserves and relentless automatic fire',
    defaultColor: '#dc2626',
    swatches: [
      { name: 'Enforcer Crimson', color: '#dc2626' },
      { name: 'Rust Iron', color: '#991b1b' },
      { name: 'Molten Amber', color: '#d97706' },
      { name: 'Charcoal', color: '#27272a' },
      { name: 'Titanium Blue', color: '#1d4ed8' }
    ]
  },
  hooda: {
    id: 'hooda',
    name: 'Hooda',
    title: 'Tactical Commando',
    classType: 'COMMANDO',
    badge: '⚔',
    bio: 'All-terrain combat operative combining aggressive frontline assault tactics with disciplined weapons handling and tactical grenade throws.',
    stats: { mobility: 86, durability: 80, precision: 84, firepower: 86 },
    signatureWeapon: 'AK-47 & Shotgun',
    signatureIcon: '🔫',
    trait: 'War-Hardened',
    traitDesc: 'Balanced combat versatility across all ranges and maps',
    defaultColor: '#7c3aed',
    swatches: [
      { name: 'Commando Violet', color: '#7c3aed' },
      { name: 'Royal Purple', color: '#6d28d9' },
      { name: 'Shadow Carbon', color: '#1e1b4b' },
      { name: 'Crimson Strike', color: '#ef4444' },
      { name: 'Vanguard Gold', color: '#f59e0b' }
    ]
  }
};

/* Skin ids (extra character models) mapped to the hero they belong to. */
export const SKIN_OF = Object.fromEntries(
  Object.values(HERO_ROSTER).flatMap(h => (h.skins || []).filter(k => k.id !== h.id).map(k => [k.id, h.id]))
);
export const baseHeroId = id => SKIN_OF[id] || id;

/* Resolves hero metadata with a fallback for custom or procedural characters */
export function getHeroData(id, nameFallback) {
  const cleanId = String(id || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (HERO_ROSTER[cleanId]) return HERO_ROSTER[cleanId];

  // Try matching by base prefix
  for (const [key, data] of Object.entries(HERO_ROSTER)) {
    if (cleanId.includes(key) || key.includes(cleanId)) return data;
  }

  // Fallback for custom user glTF models dropped into source/assets/characters/
  const displayName = nameFallback || cleanId.toUpperCase() || 'Custom Operative';
  return {
    id: cleanId,
    name: displayName,
    title: 'Custom Operative',
    classType: 'OPERATIVE',
    badge: '🎖',
    bio: `Tactical operative deployed for active duty. Field specialist trained in modern small-arms combat.`,
    stats: { mobility: 75, durability: 75, precision: 75, firepower: 75 },
    signatureWeapon: 'Service Rifle',
    signatureIcon: '🔫',
    trait: 'Combat Adaptability',
    traitDesc: 'Versatile handling across all standard weaponry',
    defaultColor: '#f0a640',
    swatches: [
      { name: 'Tactical Tan', color: '#f0a640' },
      { name: 'Red Team', color: '#ef4444' },
      { name: 'Blue Team', color: '#3b82f6' },
      { name: 'Emerald', color: '#10b981' },
      { name: 'Stealth', color: '#1f2937' }
    ]
  };
}
