/* Hero roster definitions, lore dossiers, and tactical attributes for LAN_FPS operatives. */

export const HERO_ROSTER = {
  kimo: {
    id: 'kimo',
    name: 'Kimo',
    title: 'Assault Specialist',
    classType: 'ASSAULT',
    badge: '⚡',
    bio: 'Battlefield veteran hardened in close-quarters urban skirmishes. Combines swift repositioning with disciplined trigger discipline and rapid target acquisition.',
    stats: { mobility: 85, durability: 75, precision: 75, firepower: 85 },
    signatureWeapon: 'AK-47 Assault Rifle',
    signatureIcon: '🔫',
    trait: 'Balanced Operator',
    traitDesc: 'Optimal recoil stabilization and rapid combat recovery',
    defaultColor: '#f0a640',
    swatches: [
      { name: 'Tactical Tan', color: '#f0a640' },
      { name: 'Red Strike', color: '#ef4444' },
      { name: 'Blue Vanguard', color: '#3b82f6' },
      { name: 'Jungle Camo', color: '#10b981' },
      { name: 'Night Ops', color: '#334155' }
    ]
  },
  'kimo-black': {
    id: 'kimo-black',
    name: 'Kimo Black',
    title: 'Shadow Infiltrator',
    classType: 'INFILTRATOR',
    badge: '🗡',
    bio: 'Covert black-ops operative specializing in stealth flanking, suppressed weapon engagements, and high-damage silent melee strikes from behind enemy lines.',
    stats: { mobility: 95, durability: 65, precision: 80, firepower: 80 },
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
  }
};

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
