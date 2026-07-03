// tcg.js — Trading Card Game system for BossCord
// Monster cards from character portraits, pack opening, battles, trading

const crypto = require('crypto');

// ─── Rarity definitions ───
const RARITIES = {
  common:     { name: 'Common',      color: '#9e9e9e', weight: 40, coinValue: 10 },
  uncommon:   { name: 'Uncommon',    color: '#57f287', weight: 22, coinValue: 30 },
  rare:       { name: 'Rare',        color: '#5865f2', weight: 14, coinValue: 100 },
  super_rare: { name: 'Super Rare',  color: '#00d4ff', weight: 7,  coinValue: 200 },
  epic:       { name: 'Epic',        color: '#9b59b6', weight: 5,  coinValue: 400 },
  legendary:  { name: 'Legendary',   color: '#f0b232', weight: 2.5, coinValue: 1000 },
  holographic:{ name: 'Holographic', color: '#ff69b4', weight: 1.2, coinValue: 2500 },
  mythic:     { name: 'Mythic',      color: '#ff4444', weight: 0.5, coinValue: 5000 },
  secret:     { name: 'Secret',      color: '#00ff88', weight: 0.15, coinValue: 12000 },
  godly:      { name: 'Godly',       color: '#ffd700', weight: 0.04, coinValue: 50000 },
};

// ─── Element type advantages ───
// Each type has types it's strong against (1.5x damage) and weak against (0.7x damage)
const TYPE_CHART = {
  Beast:       { strong: ['Elemental', 'Vampire'],  weak: ['Demon', 'Dragon'] },
  Demon:       { strong: ['Beast', 'Mythical'],     weak: ['Undead', 'Dragon'] },
  Undead:      { strong: ['Demon', 'Beast'],         weak: ['Elemental', 'Mythical'] },
  Elemental:   { strong: ['Undead', 'Dragon'],       weak: ['Beast', 'Abomination'] },
  Dragon:      { strong: ['Beast', 'Demon'],         weak: ['Elemental', 'Mythical'] },
  Mythical:    { strong: ['Undead', 'Dragon'],        weak: ['Demon', 'Abomination'] },
  Vampire:     { strong: ['Demon', 'Abomination'],   weak: ['Beast', 'Elemental'] },
  Abomination: { strong: ['Elemental', 'Mythical'],  weak: ['Vampire', 'Undead'] },
};

function getTypeMultiplier(attackerType, defenderType) {
  const chart = TYPE_CHART[attackerType];
  if (!chart) return 1.0;
  if (chart.strong.indexOf(defenderType) !== -1) return 1.5;
  if (chart.weak.indexOf(defenderType) !== -1) return 0.7;
  return 1.0;
}

// ─── Card catalog ───
const CARDS = [
  // ═══ GODLY (ultimate rarity) ═══
  { id: 'tcg_world_eater', name: 'World Eater', rarity: 'godly', type: 'Abomination', atk: 200, def: 120, hp: 250, img: '/icons/characters/Monsters/Devourer.PNG' },
  { id: 'tcg_primordial_dragon', name: 'Primordial Dragon', rarity: 'godly', type: 'Dragon', atk: 180, def: 160, hp: 230, img: '/icons/characters/Monsters/Monster_DragonWarrior.PNG' },

  // ═══ SECRET ═══
  { id: 'tcg_void_phoenix', name: 'Void Phoenix', rarity: 'secret', type: 'Mythical', atk: 155, def: 100, hp: 180, img: '/icons/characters/Monsters/Creatures_07_phoenix.PNG' },
  { id: 'tcg_death_sovereign', name: 'Death Sovereign', rarity: 'secret', type: 'Undead', atk: 145, def: 125, hp: 190, img: '/icons/characters/Monsters/Undead/LICH.PNG' },
  { id: 'tcg_blood_emperor', name: 'Blood Emperor', rarity: 'secret', type: 'Vampire', atk: 160, def: 90, hp: 170, img: '/icons/characters/Monsters/Vampires/Male Vampire/Monster_VoraciousVampire.PNG' },

  // ═══ MYTHIC ═══
  { id: 'tcg_devourer', name: 'The Devourer', rarity: 'mythic', type: 'Abomination', atk: 120, def: 60, hp: 150, img: '/icons/characters/Monsters/Devourer.PNG' },
  { id: 'tcg_dragon_warrior', name: 'Dragon Warrior', rarity: 'mythic', type: 'Dragon', atk: 110, def: 100, hp: 140, img: '/icons/characters/Monsters/Monster_DragonWarrior.PNG' },
  { id: 'tcg_abyssal_lord', name: 'Abyssal Lord', rarity: 'mythic', type: 'Demon', atk: 115, def: 85, hp: 135, img: '/icons/characters/Monsters/DemonicTentacles.PNG' },

  // ═══ HOLOGRAPHIC ═══
  { id: 'tcg_crystal_drake', name: 'Crystal Drake', rarity: 'holographic', type: 'Dragon', atk: 100, def: 88, hp: 125, img: '/icons/characters/Monsters/Creatures_11_Dragon.PNG' },
  { id: 'tcg_ethereal_knight', name: 'Ethereal Knight', rarity: 'holographic', type: 'Undead', atk: 95, def: 92, hp: 118, img: '/icons/characters/Monsters/Undead/Monster_GhostKnight.PNG' },
  { id: 'tcg_inferno_beast', name: 'Inferno Beast', rarity: 'holographic', type: 'Beast', atk: 105, def: 70, hp: 115, img: '/icons/characters/Monsters/Gigant_08_minotaur.PNG' },
  { id: 'tcg_storm_elemental', name: 'Storm Elemental', rarity: 'holographic', type: 'Elemental', atk: 98, def: 78, hp: 112, img: '/icons/characters/Monsters/Monster_Elemental.PNG' },
  { id: 'tcg_nightstalker', name: 'Nightstalker', rarity: 'holographic', type: 'Vampire', atk: 102, def: 65, hp: 108, img: '/icons/characters/Monsters/Vampires/Female Vampire/Monster_Vampire.PNG' },

  // ═══ LEGENDARY ═══
  { id: 'tcg_dragon', name: 'Elder Dragon', rarity: 'legendary', type: 'Dragon', atk: 95, def: 80, hp: 120, img: '/icons/characters/Monsters/Creatures_11_Dragon.PNG' },
  { id: 'tcg_phoenix', name: 'Phoenix', rarity: 'legendary', type: 'Mythical', atk: 90, def: 60, hp: 100, img: '/icons/characters/Monsters/Creatures_07_phoenix.PNG' },
  { id: 'tcg_lich', name: 'Lich King', rarity: 'legendary', type: 'Undead', atk: 88, def: 75, hp: 110, img: '/icons/characters/Monsters/Undead/LICH.PNG' },
  { id: 'tcg_skeleton_king', name: 'Skeleton King', rarity: 'legendary', type: 'Undead', atk: 92, def: 85, hp: 115, img: '/icons/characters/Monsters/Demon_12_skeleton_king.PNG' },

  // ═══ EPIC ═══
  { id: 'tcg_manticore', name: 'Manticore', rarity: 'epic', type: 'Beast', atk: 78, def: 55, hp: 90, img: '/icons/characters/Monsters/Creatures_01_Manticore.PNG' },
  { id: 'tcg_griffin', name: 'Griffin', rarity: 'epic', type: 'Mythical', atk: 75, def: 65, hp: 85, img: '/icons/characters/Monsters/Creatures_03_griffin.PNG' },
  { id: 'tcg_succubus', name: 'Succubus', rarity: 'epic', type: 'Demon', atk: 80, def: 40, hp: 75, img: '/icons/characters/Monsters/Demon_04_succubus.PNG' },
  { id: 'tcg_minotaur', name: 'Minotaur', rarity: 'epic', type: 'Beast', atk: 82, def: 70, hp: 95, img: '/icons/characters/Monsters/Gigant_08_minotaur.PNG' },
  { id: 'tcg_demonic_tentacles', name: 'Demonic Tentacles', rarity: 'epic', type: 'Demon', atk: 85, def: 35, hp: 80, img: '/icons/characters/Monsters/DemonicTentacles.PNG' },
  { id: 'tcg_war_dragon', name: 'War Dragon', rarity: 'epic', type: 'Undead', atk: 76, def: 72, hp: 88, img: '/icons/characters/Monsters/Undead/Monster_WarDragon.PNG' },
  { id: 'tcg_hungry_demon', name: 'Hungry Demon', rarity: 'epic', type: 'Demon', atk: 84, def: 45, hp: 82, img: '/icons/characters/Monsters/Monster_HungryDemon.PNG' },
  { id: 'tcg_pangolin', name: 'Giant Pangolin', rarity: 'epic', type: 'Beast', atk: 60, def: 90, hp: 100, img: '/icons/characters/Monsters/Gigant_05_pangolin.PNG' },
  { id: 'tcg_skeleton_king2', name: 'Skeleton Overlord', rarity: 'epic', type: 'Undead', atk: 74, def: 68, hp: 92, img: '/icons/characters/Monsters/Undead/Monster_SkeletonKing.PNG' },
  { id: 'tcg_ghost_knight', name: 'Ghost Knight', rarity: 'epic', type: 'Undead', atk: 70, def: 78, hp: 86, img: '/icons/characters/Monsters/Undead/Monster_GhostKnight.PNG' },
  { id: 'tcg_vampire_m', name: 'Voracious Vampire', rarity: 'epic', type: 'Vampire', atk: 77, def: 50, hp: 84, img: '/icons/characters/Monsters/Vampires/Male Vampire/Monster_VoraciousVampire.PNG' },

  // ═══ SUPER RARE ═══
  { id: 'tcg_werewolf', name: 'Werewolf Alpha', rarity: 'super_rare', type: 'Beast', atk: 72, def: 55, hp: 82, img: '/icons/characters/Monsters/Creatures_05_werewolf.PNG' },
  { id: 'tcg_terrible', name: 'Terrible Aberration', rarity: 'super_rare', type: 'Abomination', atk: 74, def: 48, hp: 78, img: '/icons/characters/Monsters/Monster_Terrible.PNG' },
  { id: 'tcg_demonic_eye', name: 'All-Seeing Eye', rarity: 'super_rare', type: 'Demon', atk: 68, def: 62, hp: 72, img: '/icons/characters/Monsters/Monster_DemonicEye.PNG' },
  { id: 'tcg_undead_dragon', name: 'Undead Dragon', rarity: 'super_rare', type: 'Undead', atk: 70, def: 64, hp: 80, img: '/icons/characters/Monsters/Undead/Undead_10_dragon.PNG' },
  { id: 'tcg_swamp', name: 'Swamp Abomination', rarity: 'super_rare', type: 'Abomination', atk: 66, def: 60, hp: 76, img: '/icons/characters/Monsters/Monster_Swamp.PNG' },

  // ═══ RARE ═══
  { id: 'tcg_demon_spider', name: 'Demon Spider', rarity: 'rare', type: 'Demon', atk: 60, def: 55, hp: 65, img: '/icons/characters/Monsters/Demon_08_spider.PNG' },
  { id: 'tcg_elemental', name: 'Elemental', rarity: 'rare', type: 'Elemental', atk: 62, def: 50, hp: 75, img: '/icons/characters/Monsters/Monster_Elemental.PNG' },
  { id: 'tcg_demonic_dog', name: 'Demonic Dog', rarity: 'rare', type: 'Demon', atk: 58, def: 48, hp: 68, img: '/icons/characters/Monsters/Monster_DemonicDog.PNG' },
  { id: 'tcg_skeleton_mage', name: 'Skeleton Mage', rarity: 'rare', type: 'Undead', atk: 64, def: 35, hp: 55, img: '/icons/characters/Monsters/Undead/Monster_SkeletonMage2.PNG' },
  { id: 'tcg_skeleton_snake', name: 'Skeleton Serpent', rarity: 'rare', type: 'Undead', atk: 58, def: 52, hp: 62, img: '/icons/characters/Monsters/Undead/Monster_SkeletonSnake.PNG' },
  { id: 'tcg_vampire_f', name: 'Vampire Countess', rarity: 'rare', type: 'Vampire', atk: 60, def: 45, hp: 66, img: '/icons/characters/Monsters/Vampires/Female Vampire/Monster_Vampire.PNG' },
  { id: 'tcg_plague', name: 'Plague Bearer', rarity: 'rare', type: 'Undead', atk: 50, def: 65, hp: 70, img: '/icons/characters/Monsters/Undead/Monster_Plague.PNG' },
  { id: 'tcg_infection', name: 'The Infection', rarity: 'rare', type: 'Abomination', atk: 52, def: 62, hp: 68, img: '/icons/characters/Monsters/Monster_Infection.PNG' },
  { id: 'tcg_monster_42', name: 'Frost Wraith', rarity: 'rare', type: 'Elemental', atk: 55, def: 55, hp: 64, img: '/icons/characters/Monsters/Monsters_42.PNG' },
  { id: 'tcg_monster_43', name: 'Dark Shaman', rarity: 'rare', type: 'Demon', atk: 63, def: 42, hp: 60, img: '/icons/characters/Monsters/Monsters_43.PNG' },

  // ═══ UNCOMMON ═══
  { id: 'tcg_spider', name: 'Giant Spider', rarity: 'uncommon', type: 'Beast', atk: 42, def: 35, hp: 50, img: '/icons/characters/Monsters/Creatures_08_spider.PNG' },
  { id: 'tcg_ratman', name: 'Ratman', rarity: 'uncommon', type: 'Beast', atk: 38, def: 40, hp: 48, img: '/icons/characters/Monsters/Creatures_14_ratman.PNG' },
  { id: 'tcg_scorpion', name: 'Giant Scorpion', rarity: 'uncommon', type: 'Beast', atk: 44, def: 50, hp: 45, img: '/icons/characters/Monsters/Monster_Scorpion.PNG' },
  { id: 'tcg_wasp', name: 'Hellwasp', rarity: 'uncommon', type: 'Beast', atk: 46, def: 25, hp: 40, img: '/icons/characters/Monsters/Monster_Wasp.PNG' },
  { id: 'tcg_demonic_fish', name: 'Demonic Fish', rarity: 'uncommon', type: 'Demon', atk: 40, def: 38, hp: 52, img: '/icons/characters/Monsters/Monster_DemonicFish.PNG' },
  { id: 'tcg_eye', name: 'Floating Eye', rarity: 'uncommon', type: 'Abomination', atk: 35, def: 42, hp: 48, img: '/icons/characters/Monsters/Monster_Eye.PNG' },
  { id: 'tcg_ghost', name: 'Ghost', rarity: 'uncommon', type: 'Undead', atk: 38, def: 30, hp: 44, img: '/icons/characters/Monsters/Undead/Monster_Ghost.PNG' },
  { id: 'tcg_drowner', name: 'Drowner', rarity: 'uncommon', type: 'Undead', atk: 40, def: 36, hp: 50, img: '/icons/characters/Monsters/Undead/Monster_drowner.PNG' },
  { id: 'tcg_undead_warrior', name: 'Undead Warrior', rarity: 'uncommon', type: 'Undead', atk: 42, def: 45, hp: 55, img: '/icons/characters/Monsters/Undead/Undead_04_warrior.PNG' },
  { id: 'tcg_undead_knight', name: 'Undead Knight', rarity: 'uncommon', type: 'Undead', atk: 45, def: 48, hp: 52, img: '/icons/characters/Monsters/Undead/Undead_02_knight.PNG' },
  { id: 'tcg_undead_archer', name: 'Undead Archer', rarity: 'uncommon', type: 'Undead', atk: 48, def: 28, hp: 42, img: '/icons/characters/Monsters/Undead/Undead_01_archer.PNG' },
  { id: 'tcg_ghost_spirit', name: 'Ghost Spirit', rarity: 'uncommon', type: 'Undead', atk: 36, def: 32, hp: 46, img: '/icons/characters/Monsters/Undead/Undead_09_ghost.PNG' },
  { id: 'tcg_infected_dog', name: 'Infected Hound', rarity: 'uncommon', type: 'Beast', atk: 44, def: 30, hp: 46, img: '/icons/characters/Monsters/Monster_InfectedDog.PNG' },
  { id: 'tcg_flower2', name: 'Poison Bloom', rarity: 'uncommon', type: 'Elemental', atk: 35, def: 40, hp: 50, img: '/icons/characters/Monsters/Monster_Flower2.PNG' },
  { id: 'tcg_flower3', name: 'Carnivorous Plant', rarity: 'uncommon', type: 'Elemental', atk: 40, def: 35, hp: 48, img: '/icons/characters/Monsters/Monster_Flower3.PNG' },
  { id: 'tcg_waterman', name: 'Water Elemental', rarity: 'uncommon', type: 'Elemental', atk: 38, def: 44, hp: 52, img: '/icons/characters/Monsters/Monster_waterm.PNG' },
  { id: 'tcg_monster_50', name: 'Shadow Stalker', rarity: 'uncommon', type: 'Demon', atk: 46, def: 32, hp: 44, img: '/icons/characters/Monsters/Monsters_50.PNG' },
  { id: 'tcg_monster_63', name: 'Cave Lurker', rarity: 'uncommon', type: 'Beast', atk: 40, def: 38, hp: 50, img: '/icons/characters/Monsters/Monsters_63.PNG' },
  { id: 'tcg_monster_64', name: 'Swamp Troll', rarity: 'uncommon', type: 'Beast', atk: 43, def: 42, hp: 54, img: '/icons/characters/Monsters/Monsters_64.PNG' },
  { id: 'tcg_vampire_f2', name: 'Vampiress', rarity: 'uncommon', type: 'Vampire', atk: 44, def: 34, hp: 48, img: '/icons/characters/Monsters/Vampires/Female Vampire/Monsters_41.PNG' },
  { id: 'tcg_vampire_m2', name: 'Vampire Lord', rarity: 'uncommon', type: 'Vampire', atk: 46, def: 36, hp: 50, img: '/icons/characters/Monsters/Vampires/Male Vampire/Monsters_33.PNG' },

  // ═══ COMMON ═══
  { id: 'tcg_spider2', name: 'Cave Spider', rarity: 'common', type: 'Beast', atk: 25, def: 22, hp: 32, img: '/icons/characters/Monsters/Monster_Spider.PNG' },
  { id: 'tcg_slime', name: 'Slime', rarity: 'common', type: 'Elemental', atk: 15, def: 30, hp: 35, img: '/icons/characters/Monsters/Monster_Slime.PNG' },
  { id: 'tcg_worm', name: 'Giant Worm', rarity: 'common', type: 'Beast', atk: 22, def: 28, hp: 38, img: '/icons/characters/Monsters/Monster_Worm.PNG' },
  { id: 'tcg_fly', name: 'Plague Fly', rarity: 'common', type: 'Beast', atk: 28, def: 15, hp: 25, img: '/icons/characters/Monsters/Monster_Fly.PNG' },
  { id: 'tcg_flower', name: 'Flower Beast', rarity: 'common', type: 'Elemental', atk: 20, def: 25, hp: 30, img: '/icons/characters/Monsters/Monster_Flower.PNG' },
  { id: 'tcg_fish', name: 'Monster Fish', rarity: 'common', type: 'Beast', atk: 22, def: 20, hp: 28, img: '/icons/characters/Monsters/Monster_fish.PNG' },
  { id: 'tcg_zombie', name: 'Zombie', rarity: 'common', type: 'Undead', atk: 24, def: 18, hp: 34, img: '/icons/characters/Monsters/Undead/Monster_Zombie.PNG' },
  { id: 'tcg_skeleton', name: 'Skeleton', rarity: 'common', type: 'Undead', atk: 20, def: 22, hp: 28, img: '/icons/characters/Monsters/Undead/Undead_05_skeleton.PNG' },
  { id: 'tcg_zombie2', name: 'Rotting Zombie', rarity: 'common', type: 'Undead', atk: 26, def: 16, hp: 32, img: '/icons/characters/Monsters/Undead/Undead_06_zombie.PNG' },
  { id: 'tcg_undead1', name: 'Risen Corpse', rarity: 'common', type: 'Undead', atk: 22, def: 20, hp: 30, img: '/icons/characters/Monsters/Undead/Undead_01.PNG' },
  { id: 'tcg_undead2', name: 'Hollow One', rarity: 'common', type: 'Undead', atk: 24, def: 24, hp: 28, img: '/icons/characters/Monsters/Undead/Undead_02.PNG' },
  { id: 'tcg_undead3', name: 'Bonepile', rarity: 'common', type: 'Undead', atk: 18, def: 26, hp: 32, img: '/icons/characters/Monsters/Undead/Undead_03.PNG' },
  { id: 'tcg_undead3_1', name: 'Shambling Dead', rarity: 'common', type: 'Undead', atk: 20, def: 22, hp: 30, img: '/icons/characters/Monsters/Undead/Undead_03_1.PNG' },
  { id: 'tcg_undead5', name: 'Grave Walker', rarity: 'common', type: 'Undead', atk: 22, def: 20, hp: 28, img: '/icons/characters/Monsters/Undead/Undead_05.PNG' },
  { id: 'tcg_undead7', name: 'Corpse Husk', rarity: 'common', type: 'Undead', atk: 24, def: 18, hp: 26, img: '/icons/characters/Monsters/Undead/Undead_07.PNG' },
  { id: 'tcg_undead10', name: 'Soul Wretch', rarity: 'common', type: 'Undead', atk: 26, def: 16, hp: 30, img: '/icons/characters/Monsters/Undead/Undead_10.PNG' },
  { id: 'tcg_undead11', name: 'Bone Crawler', rarity: 'common', type: 'Undead', atk: 20, def: 24, hp: 28, img: '/icons/characters/Monsters/Undead/Undead_11.PNG' },
  { id: 'tcg_undead13', name: 'Crypt Dweller', rarity: 'common', type: 'Undead', atk: 22, def: 22, hp: 30, img: '/icons/characters/Monsters/Undead/Undead_13.PNG' },
  { id: 'tcg_undead_generic', name: 'Reanimated', rarity: 'common', type: 'Undead', atk: 18, def: 20, hp: 32, img: '/icons/characters/Monsters/Undead/Monster_Undead.PNG' },
  { id: 'tcg_monsters_01', name: 'Crypt Fiend', rarity: 'common', type: 'Undead', atk: 25, def: 20, hp: 30, img: '/icons/characters/Monsters/Undead/Monsters_01.PNG' },
  { id: 'tcg_monsters_02', name: 'Imp', rarity: 'common', type: 'Demon', atk: 28, def: 15, hp: 26, img: '/icons/characters/Monsters/Monsters_02.PNG' },
  { id: 'tcg_monsters_03', name: 'Dark Specter', rarity: 'common', type: 'Undead', atk: 22, def: 18, hp: 28, img: '/icons/characters/Monsters/Undead/Monsters_03.PNG' },
  { id: 'tcg_monsters_04', name: 'Shade', rarity: 'common', type: 'Undead', atk: 20, def: 20, hp: 26, img: '/icons/characters/Monsters/Undead/Monsters_04.PNG' },
  { id: 'tcg_monsters_14', name: 'Wild Beast', rarity: 'common', type: 'Beast', atk: 26, def: 22, hp: 30, img: '/icons/characters/Monsters/Monsters_14.PNG' },
  { id: 'tcg_monsters_18', name: 'Goblin Scout', rarity: 'common', type: 'Beast', atk: 24, def: 18, hp: 28, img: '/icons/characters/Monsters/Monsters_18.PNG' },
  { id: 'tcg_monsters_19', name: 'Feral Cat', rarity: 'common', type: 'Beast', atk: 28, def: 14, hp: 24, img: '/icons/characters/Monsters/Monsters_19.PNG' },
  { id: 'tcg_monsters_20', name: 'Desert Lizard', rarity: 'common', type: 'Beast', atk: 22, def: 24, hp: 30, img: '/icons/characters/Monsters/Monsters_20.PNG' },
  { id: 'tcg_monsters_32', name: 'Marsh Toad', rarity: 'common', type: 'Beast', atk: 18, def: 26, hp: 34, img: '/icons/characters/Monsters/Monsters_32.PNG' },
  { id: 'tcg_monster_08', name: 'Rock Golem', rarity: 'common', type: 'Elemental', atk: 20, def: 30, hp: 36, img: '/icons/characters/Monsters/Monster_08.PNG' },
  { id: 'tcg_monster_12', name: 'Forest Spirit', rarity: 'common', type: 'Elemental', atk: 22, def: 24, hp: 30, img: '/icons/characters/Monsters/Monster_12.PNG' },
  { id: 'tcg_monster_13', name: 'Mud Lurker', rarity: 'common', type: 'Beast', atk: 24, def: 22, hp: 28, img: '/icons/characters/Monsters/Monster_13.PNG' },
];

// Index cards for fast lookup
const CARD_MAP = new Map();
for (const card of CARDS) CARD_MAP.set(card.id, card);

const CARDS_BY_RARITY = {};
for (const r of Object.keys(RARITIES)) {
  CARDS_BY_RARITY[r] = CARDS.filter(c => c.rarity === r);
}

// ─── Random helpers ───

function weightedRandom(options) {
  const total = options.reduce((s, o) => s + o.weight, 0);
  let r = crypto.randomInt(Math.max(1, Math.ceil(total)));
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) return o.value;
  }
  return options[options.length - 1].value;
}

function rollRarity(boost) {
  boost = boost || 0;
  const options = Object.entries(RARITIES).map(([key, val]) => ({
    value: key,
    weight: key === 'common' ? Math.max(1, val.weight - boost) : val.weight + (boost / 4),
  }));
  return weightedRandom(options);
}

function rollCard(boost) {
  const rarity = rollRarity(boost);
  const pool = CARDS_BY_RARITY[rarity];
  if (!pool || pool.length === 0) return CARDS[0];
  return pool[crypto.randomInt(pool.length)];
}

// ─── Stat randomization ───

function randomizeStat(base, variance) {
  var min = Math.floor(base * (1 - variance));
  var max = Math.ceil(base * (1 + variance));
  return crypto.randomInt(max - min + 1) + min;
}

// ─── Pack system ───

const PACK_TIERS = {
  starter: { id: 'starter', name: 'Starter Pack',   cost: 50,   cards: 3, boost: 0,  color: '#72767d', guaranteedRare: false, desc: '3 cards, budget friendly' },
  basic:   { id: 'basic',   name: 'Basic Pack',     cost: 100,  cards: 5, boost: 0,  color: '#57f287', guaranteedRare: false, desc: '5 cards, common pool' },
  premium: { id: 'premium', name: 'Premium Pack',   cost: 300,  cards: 5, boost: 10, color: '#5865f2', guaranteedRare: true,  desc: '5 cards, guaranteed rare+' },
  ultra:   { id: 'ultra',   name: 'Ultra Pack',     cost: 750,  cards: 5, boost: 25, color: '#f0b232', guaranteedRare: true,  desc: '5 cards, weighted epic+' },
  shadow:  { id: 'shadow',  name: 'Shadow Pack',    cost: 500,  cards: 5, boost: 15, color: '#9b59b6', guaranteedRare: true,  desc: '5 cards, Undead & Demon only', typeFilter: ['Undead', 'Demon'] },
  elite:   { id: 'elite',   name: 'Elite Pack',     cost: 1500, cards: 5, boost: 30, color: '#ff69b4', guaranteedRare: true,  desc: '5 cards, guaranteed epic+' },
  legendary:{ id: 'legendary', name: 'Legendary Pack', cost: 3000, cards: 5, boost: 35, color: '#ff4444', guaranteedRare: true, desc: '5 cards, guaranteed legendary+' },
  void:    { id: 'void',    name: 'Void Pack',      cost: 7500, cards: 7, boost: 40, color: '#00ff88', guaranteedRare: true,  desc: '7 cards, best odds, all rarities' },
};

function rollCardFiltered(boost, typeFilter) {
  if (!typeFilter || typeFilter.length === 0) return rollCard(boost);
  const rarity = rollRarity(boost);
  var pool = (CARDS_BY_RARITY[rarity] || []).filter(c => typeFilter.indexOf(c.type) !== -1);
  if (pool.length === 0) {
    // Fallback: any card of allowed type
    pool = CARDS.filter(c => typeFilter.indexOf(c.type) !== -1);
  }
  if (pool.length === 0) return CARDS[0];
  return pool[crypto.randomInt(pool.length)];
}

function openPack(tier) {
  const pack = PACK_TIERS[tier];
  if (!pack) return null;

  const cards = [];
  var shinyBonus = tier === 'void' ? 0.08 : tier === 'legendary' ? 0.07 : 0.05;

  for (let i = 0; i < pack.cards; i++) {
    let card;
    // Last card: guaranteed rare or better (depending on pack tier)
    if (pack.guaranteedRare && i === pack.cards - 1) {
      if (tier === 'void') {
        // Void: weighted across all high rarities
        const options = [
          { value: 'rare', weight: 20 },
          { value: 'super_rare', weight: 20 },
          { value: 'epic', weight: 25 },
          { value: 'legendary', weight: 18 },
          { value: 'holographic', weight: 10 },
          { value: 'mythic', weight: 5 },
          { value: 'secret', weight: 1.5 },
          { value: 'godly', weight: 0.5 },
        ];
        const rarity = weightedRandom(options);
        const pool = CARDS_BY_RARITY[rarity] || [];
        card = pool.length > 0 ? pool[crypto.randomInt(pool.length)] : CARDS[0];
      } else if (tier === 'legendary') {
        // Legendary pack: guaranteed legendary or better
        const options = [
          { value: 'legendary', weight: 55 },
          { value: 'holographic', weight: 25 },
          { value: 'mythic', weight: 15 },
          { value: 'secret', weight: 4 },
          { value: 'godly', weight: 1 },
        ];
        const rarity = weightedRandom(options);
        const pool = CARDS_BY_RARITY[rarity] || [];
        card = pool.length > 0 ? pool[crypto.randomInt(pool.length)] : CARDS[0];
      } else if (tier === 'elite') {
        // Elite: guaranteed epic or better
        const options = [
          { value: 'epic', weight: 45 },
          { value: 'legendary', weight: 30 },
          { value: 'holographic', weight: 15 },
          { value: 'mythic', weight: 8 },
          { value: 'secret', weight: 2 },
        ];
        const rarity = weightedRandom(options);
        const pool = CARDS_BY_RARITY[rarity] || [];
        card = pool.length > 0 ? pool[crypto.randomInt(pool.length)] : CARDS[0];
      } else if (tier === 'ultra') {
        // Ultra: weighted towards epic/legendary
        const options = [
          { value: 'rare', weight: 40 },
          { value: 'super_rare', weight: 20 },
          { value: 'epic', weight: 25 },
          { value: 'legendary', weight: 12 },
          { value: 'holographic', weight: 3 },
        ];
        const rarity = weightedRandom(options);
        const pool = CARDS_BY_RARITY[rarity] || [];
        card = pool.length > 0 ? pool[crypto.randomInt(pool.length)] : CARDS[0];
      } else {
        // Premium/Shadow: guaranteed rare+
        const rarePool = CARDS.filter(c => {
          var isRareOrBetter = c.rarity === 'rare' || c.rarity === 'super_rare' || c.rarity === 'epic' || c.rarity === 'legendary';
          if (pack.typeFilter) return isRareOrBetter && pack.typeFilter.indexOf(c.type) !== -1;
          return isRareOrBetter;
        });
        card = rarePool.length > 0 ? rarePool[crypto.randomInt(rarePool.length)] : CARDS[0];
      }
    } else {
      card = pack.typeFilter ? rollCardFiltered(pack.boost, pack.typeFilter) : rollCard(pack.boost);
    }
    // Randomize stats: ATK/DEF +-15%, HP +-10%
    var rolledAtk = randomizeStat(card.atk, 0.15);
    var rolledDef = randomizeStat(card.def, 0.15);
    var rolledHp  = randomizeStat(card.hp,  0.10);

    // Shiny roll: base 5% (higher for premium packs), +10% all stats, 3x sell value
    var isShiny = crypto.randomInt(10000) < (shinyBonus * 10000);
    if (isShiny) {
      rolledAtk = Math.ceil(rolledAtk * 1.10);
      rolledDef = Math.ceil(rolledDef * 1.10);
      rolledHp  = Math.ceil(rolledHp  * 1.10);
    }

    cards.push({
      instanceId: crypto.randomBytes(6).toString('hex'),
      cardId: card.id,
      card: { id: card.id, name: card.name, rarity: card.rarity, type: card.type, atk: rolledAtk, def: rolledDef, hp: rolledHp, baseAtk: card.atk, baseDef: card.def, baseHp: card.hp, img: card.img, rarityColor: RARITIES[card.rarity] ? RARITIES[card.rarity].color : '#9e9e9e', coinValue: RARITIES[card.rarity] ? RARITIES[card.rarity].coinValue : 10, shiny: isShiny },
      rolledStats: { atk: rolledAtk, def: rolledDef, hp: rolledHp },
      shiny: isShiny,
      obtainedAt: Date.now(),
      source: 'pack_' + tier,
    });
  }

  return { tier, pack: { name: pack.name, cost: pack.cost, cards: pack.cards, color: pack.color, desc: pack.desc || '' }, cards };
}

// ─── Special Pack opening (key-gated card packs from loot.js SPECIAL_PACKS) ───

function openSpecialPack(tier, specialPacks) {
  var packDef = specialPacks[tier];
  if (!packDef) return null;

  // Map minRarity to a boost + guaranteed last-card logic
  var minRarityBoosts = {
    uncommon:  { boost: 5,  lastCardOptions: [{ value: 'uncommon', weight: 40 }, { value: 'rare', weight: 30 }, { value: 'super_rare', weight: 15 }, { value: 'epic', weight: 10 }, { value: 'legendary', weight: 5 }] },
    rare:      { boost: 15, lastCardOptions: [{ value: 'rare', weight: 35 }, { value: 'super_rare', weight: 25 }, { value: 'epic', weight: 20 }, { value: 'legendary', weight: 12 }, { value: 'holographic', weight: 6 }, { value: 'mythic', weight: 2 }] },
    epic:      { boost: 30, lastCardOptions: [{ value: 'epic', weight: 40 }, { value: 'legendary', weight: 30 }, { value: 'holographic', weight: 18 }, { value: 'mythic', weight: 9 }, { value: 'secret', weight: 3 }] },
    legendary: { boost: 40, lastCardOptions: [{ value: 'legendary', weight: 40 }, { value: 'holographic', weight: 25 }, { value: 'mythic', weight: 20 }, { value: 'secret', weight: 10 }, { value: 'godly', weight: 5 }] },
  };

  var cfg = minRarityBoosts[packDef.minRarity] || minRarityBoosts.uncommon;
  var numCards = packDef.cards || 3;
  var cards = [];
  var shinyBonus = cfg.boost >= 30 ? 0.08 : 0.05;

  for (var i = 0; i < numCards; i++) {
    var card;
    if (i === numCards - 1 && cfg.lastCardOptions) {
      // Last card: guaranteed minimum rarity
      var rarity = weightedRandom(cfg.lastCardOptions);
      var pool = CARDS_BY_RARITY[rarity] || [];
      card = pool.length > 0 ? pool[crypto.randomInt(pool.length)] : CARDS[0];
    } else {
      card = rollCard(cfg.boost);
    }

    var rolledAtk = randomizeStat(card.atk, 0.15);
    var rolledDef = randomizeStat(card.def, 0.15);
    var rolledHp  = randomizeStat(card.hp,  0.10);
    var isShiny = crypto.randomInt(10000) < (shinyBonus * 10000);
    if (isShiny) {
      rolledAtk = Math.ceil(rolledAtk * 1.10);
      rolledDef = Math.ceil(rolledDef * 1.10);
      rolledHp  = Math.ceil(rolledHp  * 1.10);
    }

    cards.push({
      instanceId: crypto.randomBytes(6).toString('hex'),
      cardId: card.id,
      card: { id: card.id, name: card.name, rarity: card.rarity, type: card.type, atk: rolledAtk, def: rolledDef, hp: rolledHp, baseAtk: card.atk, baseDef: card.def, baseHp: card.hp, img: card.img, rarityColor: RARITIES[card.rarity] ? RARITIES[card.rarity].color : '#9e9e9e', coinValue: RARITIES[card.rarity] ? RARITIES[card.rarity].coinValue : 10, shiny: isShiny },
      rolledStats: { atk: rolledAtk, def: rolledDef, hp: rolledHp },
      shiny: isShiny,
      obtainedAt: Date.now(),
      source: 'special_pack_' + tier,
    });
  }

  return { tier: tier, pack: { name: packDef.name, color: packDef.color, cards: numCards, desc: packDef.minRarity + '+ guaranteed' }, cards: cards };
}

// ─── Battle system (1v1 turn-based) ───

const BATTLE_TIMEOUT_MS = 120000; // 2 min to make a move
const MAX_DECK_SIZE = 10;

class TCGBattleManager {
  constructor() {
    this.battles = new Map();       // Map<battleId, battle>
    this.playerBattle = new Map();  // Map<socketId, battleId>
    this.challenges = new Map();    // Map<targetSocketId, { from, battleId, timestamp }>
    this.nextId = 1;
  }

  challenge(fromSocketId, toSocketId, fromName, fromColor) {
    if (this.playerBattle.has(fromSocketId)) return { error: 'Already in a battle' };
    if (this.playerBattle.has(toSocketId)) return { error: 'Opponent is in a battle' };
    if (fromSocketId === toSocketId) return { error: 'Cannot challenge yourself' };

    const battleId = 'TCG' + (this.nextId++);
    this.challenges.set(toSocketId, {
      from: fromSocketId,
      fromName: fromName || 'Anon',
      fromColor: fromColor || '#dcddde',
      battleId,
      timestamp: Date.now(),
    });
    return { battleId, challenged: toSocketId };
  }

  acceptChallenge(targetSocketId, targetName, targetColor, getDeck) {
    const challenge = this.challenges.get(targetSocketId);
    if (!challenge) return null;
    if (Date.now() - challenge.timestamp > 60000) {
      this.challenges.delete(targetSocketId);
      return null; // expired
    }
    this.challenges.delete(targetSocketId);

    if (this.playerBattle.has(challenge.from) || this.playerBattle.has(targetSocketId)) return null;

    const battle = {
      id: challenge.battleId,
      state: 'selecting', // selecting, fighting, finished
      players: new Map(),
      currentTurn: null,
      turnTimer: null,
      round: 0,
      log: [],
      createdAt: Date.now(),
    };

    battle.players.set(challenge.from, {
      id: challenge.from,
      name: challenge.fromName,
      color: challenge.fromColor,
      deck: [],
      activeSlots: [],    // 2 active card indices into deck
      activeCards: [],     // the 2 active card objects
      activeHps: [],       // HP for each active slot
      ready: false,
    });

    battle.players.set(targetSocketId, {
      id: targetSocketId,
      name: targetName || 'Anon',
      color: targetColor || '#dcddde',
      deck: [],
      activeSlots: [],
      activeCards: [],
      activeHps: [],
      ready: false,
    });

    this.battles.set(battle.id, battle);
    this.playerBattle.set(challenge.from, battle.id);
    this.playerBattle.set(targetSocketId, battle.id);

    return battle;
  }

  declineChallenge(targetSocketId) {
    const challenge = this.challenges.get(targetSocketId);
    this.challenges.delete(targetSocketId);
    return challenge || null;
  }

  // Player selects their deck (array of instanceIds with card data)
  setDeck(socketId, deckCards) {
    const battleId = this.playerBattle.get(socketId);
    if (!battleId) return null;
    const battle = this.battles.get(battleId);
    if (!battle || battle.state !== 'selecting') return null;

    const player = battle.players.get(socketId);
    if (!player) return null;

    if (!Array.isArray(deckCards) || deckCards.length < 5 || deckCards.length > MAX_DECK_SIZE) return null;

    // Validate all cards exist in server catalog before building deck
    var validDeckCards = [];
    for (var ci = 0; ci < deckCards.length && validDeckCards.length < MAX_DECK_SIZE; ci++) {
      var c = deckCards[ci];
      var lookupId = c.cardId || (c.card && c.card.id);
      var canonicalCard = CARD_MAP.get(lookupId);
      if (!canonicalCard) continue; // reject cards not in server catalog
      // Build card data entirely from server-side canonical stats — never trust client stats
      var cardData = {
        id: canonicalCard.id,
        name: canonicalCard.name,
        rarity: canonicalCard.rarity,
        type: canonicalCard.type,
        img: canonicalCard.img,
        hp: canonicalCard.hp,
        atk: canonicalCard.atk,
        def: canonicalCard.def,
      };
      validDeckCards.push({
        instanceId: c.instanceId,
        cardId: canonicalCard.id,
        card: cardData,
        alive: true,
        currentHp: cardData.hp,
      });
    }
    if (validDeckCards.length < 5) return null; // not enough valid cards
    player.deck = validDeckCards;
    player.ready = true;

    // Check if both players ready
    let allReady = true;
    for (const [, p] of battle.players) {
      if (!p.ready) { allReady = false; break; }
    }

    if (allReady) {
      battle.state = 'fighting';
      battle.round = 1;
      // Each player deploys first 2 cards as active
      for (const [, p] of battle.players) {
        p.activeSlots = [0, Math.min(1, p.deck.length - 1)];
        p.activeCards = p.activeSlots.map(function(idx) { return p.deck[idx].card; });
        p.activeHps = p.activeSlots.map(function(idx) { return p.deck[idx].currentHp; });
        // Legacy compat
        p.activePick = 0;
        p.activeCard = p.deck[0].card;
        p.activeHp = p.deck[0].currentHp;
      }
      // Random first turn
      const ids = [...battle.players.keys()];
      battle.currentTurn = ids[crypto.randomInt(ids.length)];
      battle.log.push({ type: 'start', msg: 'Battle begins! Deploy your synergies!' });
    }

    return battle;
  }

  // Execute an attack (2-card synergy system)
  attack(socketId, targetSlot) {
    const battleId = this.playerBattle.get(socketId);
    if (!battleId) return null;
    const battle = this.battles.get(battleId);
    if (!battle || battle.state !== 'fighting') return null;
    if (battle.currentTurn !== socketId) return null;

    const attacker = battle.players.get(socketId);
    const defenderId = [...battle.players.keys()].find(id => id !== socketId);
    const defender = battle.players.get(defenderId);
    if (!attacker || !defender) return null;

    // Determine target slot (0 or 1)
    targetSlot = targetSlot === 1 ? 1 : 0;
    var defSlotIdx = defender.activeSlots[targetSlot];
    var defCard = defender.deck[defSlotIdx];
    // If targeted card is dead, try the other slot
    if (!defCard || !defCard.alive) {
      targetSlot = targetSlot === 0 ? 1 : 0;
      defSlotIdx = defender.activeSlots[targetSlot];
      defCard = defSlotIdx !== undefined ? defender.deck[defSlotIdx] : null;
      if (!defCard || !defCard.alive) return null;
    }

    // Get attacker's active cards
    var primaryIdx = attacker.activeSlots[0];
    var secondaryIdx = attacker.activeSlots.length > 1 ? attacker.activeSlots[1] : null;
    var primaryCard = attacker.deck[primaryIdx];
    var secondaryCard = secondaryIdx !== null && secondaryIdx !== undefined ? attacker.deck[secondaryIdx] : null;
    if (!primaryCard || !primaryCard.alive) {
      // If primary is dead, swap roles
      if (secondaryCard && secondaryCard.alive) {
        primaryCard = secondaryCard;
        secondaryCard = null;
      } else {
        return null;
      }
    }

    // Combined ATK = primary.atk + secondary.atk * 0.6
    var combinedAtk = primaryCard.card.atk;
    if (secondaryCard && secondaryCard.alive) {
      combinedAtk += secondaryCard.card.atk * 0.6;
    }

    // Combined DEF for defender's active cards
    var combinedDef = 0;
    for (var di = 0; di < defender.activeSlots.length; di++) {
      var dIdx = defender.activeSlots[di];
      var dCard = defender.deck[dIdx];
      if (dCard && dCard.alive) combinedDef += dCard.card.def;
    }
    combinedDef = combinedDef / 1.5;

    // Synergy bonus: both active attacker cards share same type
    var synergy = false;
    if (secondaryCard && secondaryCard.alive && primaryCard.card.type === secondaryCard.card.type) {
      synergy = true;
      combinedAtk *= 1.15;   // +15% ATK
    }

    // Type advantage: use primary card's type
    var typeMultiplier = getTypeMultiplier(primaryCard.card.type, defCard.card.type);

    // Damage formula
    var atkRoll = combinedAtk * ((700 + crypto.randomInt(600)) / 1000) * typeMultiplier;
    var defReduction = combinedDef * 0.3;
    var damage = Math.max(1, Math.floor(atkRoll - defReduction));
    var typeEffective = typeMultiplier > 1 ? 'super_effective' : typeMultiplier < 1 ? 'not_effective' : 'neutral';

    defCard.currentHp = Math.max(0, defCard.currentHp - damage);
    defender.activeHps[targetSlot] = defCard.currentHp;
    // Legacy compat
    defender.activeHp = defender.activeHps[0];

    var logEntry = {
      type: 'attack',
      attacker: attacker.name,
      attackerCard: primaryCard.card.name,
      attackerType: primaryCard.card.type,
      secondaryCard: secondaryCard && secondaryCard.alive ? secondaryCard.card.name : null,
      synergy: synergy,
      defender: defender.name,
      defenderCard: defCard.card.name,
      defenderType: defCard.card.type,
      targetSlot: targetSlot,
      damage: damage,
      remainingHp: defCard.currentHp,
      typeEffective: typeEffective,
      typeMultiplier: typeMultiplier,
    };
    battle.log.push(logEntry);

    // Check if defender's targeted card is dead
    if (defCard.currentHp <= 0) {
      defCard.alive = false;
      battle.log.push({ type: 'ko', card: defCard.card.name, player: defender.name });

      // Try to deploy from bench into the empty slot
      var bench = [];
      for (var bi = 0; bi < defender.deck.length; bi++) {
        if (defender.deck[bi].alive && defender.activeSlots.indexOf(bi) === -1) {
          bench.push(bi);
        }
      }
      if (bench.length > 0) {
        var benchIdx = bench[0];
        defender.activeSlots[targetSlot] = benchIdx;
        defender.activeCards[targetSlot] = defender.deck[benchIdx].card;
        defender.activeHps[targetSlot] = defender.deck[benchIdx].currentHp;
        battle.log.push({ type: 'deploy', player: defender.name, card: defender.deck[benchIdx].card.name, slot: targetSlot });
      }

      // Check if ALL defender cards are dead
      var anyAlive = defender.deck.some(function(c) { return c.alive; });
      if (!anyAlive) {
        battle.state = 'finished';
        battle.winner = socketId;
        battle.loser = defenderId;
        battle.log.push({ type: 'victory', winner: attacker.name, loser: defender.name });
        this._cleanup(battle.id);
        return { battle, logEntry: logEntry, finished: true, winner: socketId, loser: defenderId };
      }
    }

    // Legacy compat updates
    attacker.activePick = attacker.activeSlots[0];
    attacker.activeCard = attacker.activeCards[0];

    // Switch turn
    battle.currentTurn = defenderId;
    battle.round++;

    return { battle, logEntry: logEntry, finished: false };
  }

  // Switch active card in a specific slot (0 or 1)
  switchCard(socketId, activeSlotIndex, deckIndex) {
    const battleId = this.playerBattle.get(socketId);
    if (!battleId) return null;
    const battle = this.battles.get(battleId);
    if (!battle || battle.state !== 'fighting') return null;
    if (battle.currentTurn !== socketId) return null;

    const player = battle.players.get(socketId);
    if (!player) return null;
    // Validate slot index (0 or 1)
    activeSlotIndex = activeSlotIndex === 1 ? 1 : 0;
    if (deckIndex < 0 || deckIndex >= player.deck.length) return null;
    if (!player.deck[deckIndex].alive) return null;
    // Can't swap to a card that's already active
    if (player.activeSlots.indexOf(deckIndex) !== -1) return null;

    var oldCard = player.deck[player.activeSlots[activeSlotIndex]];
    player.activeSlots[activeSlotIndex] = deckIndex;
    player.activeCards[activeSlotIndex] = player.deck[deckIndex].card;
    player.activeHps[activeSlotIndex] = player.deck[deckIndex].currentHp;

    // Legacy compat
    player.activePick = player.activeSlots[0];
    player.activeCard = player.activeCards[0];
    player.activeHp = player.activeHps[0];

    // Switching costs your turn
    const defenderId = [...battle.players.keys()].find(id => id !== socketId);
    battle.currentTurn = defenderId;
    battle.round++;

    battle.log.push({ type: 'switch', player: player.name, slot: activeSlotIndex, oldCard: oldCard ? oldCard.card.name : null, card: player.deck[deckIndex].card.name });

    return { battle, finished: false };
  }

  // Surrender
  surrender(socketId) {
    const battleId = this.playerBattle.get(socketId);
    if (!battleId) return null;
    const battle = this.battles.get(battleId);
    if (!battle || battle.state === 'finished') return null;

    const winnerId = [...battle.players.keys()].find(id => id !== socketId);
    battle.state = 'finished';
    battle.winner = winnerId;
    battle.loser = socketId;
    const loserName = battle.players.get(socketId).name;
    const winnerName = battle.players.get(winnerId).name;
    battle.log.push({ type: 'surrender', player: loserName });
    battle.log.push({ type: 'victory', winner: winnerName, loser: loserName });

    this._cleanup(battle.id);
    return { battle, winner: winnerId, loser: socketId };
  }

  leaveBattle(socketId) {
    const battleId = this.playerBattle.get(socketId);
    if (!battleId) return null;
    // Treat as surrender if battle is active
    const battle = this.battles.get(battleId);
    if (battle && battle.state !== 'finished') {
      return this.surrender(socketId);
    }
    this.playerBattle.delete(socketId);
    return { battle, left: true };
  }

  getBattleState(battleId, forSocketId) {
    const battle = this.battles.get(battleId);
    if (!battle) return null;

    const players = [];
    for (const [id, p] of battle.players) {
      // Build active slots info
      var activeSlotData = [];
      for (var si = 0; si < (p.activeSlots || []).length; si++) {
        var slotIdx = p.activeSlots[si];
        var slotCard = p.deck[slotIdx];
        if (slotCard) {
          activeSlotData.push({
            slotIndex: si,
            deckIndex: slotIdx,
            card: slotCard.card,
            currentHp: slotCard.currentHp,
            alive: slotCard.alive,
          });
        }
      }
      // Determine synergy (both active cards share type)
      var hasSynergy = false;
      if (activeSlotData.length === 2 && activeSlotData[0].alive && activeSlotData[1].alive) {
        hasSynergy = activeSlotData[0].card.type === activeSlotData[1].card.type;
      }

      players.push({
        id: p.id,
        name: p.name,
        color: p.color,
        ready: p.ready,
        // Legacy single-card fields
        activePick: p.activePick,
        activeCard: p.activeCard,
        activeHp: p.activeHp,
        // New 2-card fields
        activeSlots: activeSlotData,
        hasSynergy: hasSynergy,
        deck: p.deck.map(function(c, idx) {
          return {
            instanceId: c.instanceId,
            cardId: c.cardId,
            card: c.card,
            alive: c.alive,
            currentHp: c.currentHp,
            isActive: (p.activeSlots || []).indexOf(idx) !== -1,
          };
        }),
        cardsAlive: p.deck.filter(c => c.alive).length,
        totalCards: p.deck.length,
        bench: p.deck.reduce(function(acc, c, idx) {
          if (c.alive && (p.activeSlots || []).indexOf(idx) === -1) {
            acc.push({ deckIndex: idx, card: c.card, currentHp: c.currentHp });
          }
          return acc;
        }, []),
      });
    }

    return {
      id: battle.id,
      state: battle.state,
      currentTurn: battle.currentTurn,
      round: battle.round,
      players,
      log: battle.log.slice(-20),
      winner: battle.winner || null,
      loser: battle.loser || null,
    };
  }

  _cleanup(battleId) {
    const battle = this.battles.get(battleId);
    if (!battle) return;
    if (battle.turnTimer) clearTimeout(battle.turnTimer);
    // Keep battle for results display, clean up after 30s
    setTimeout(() => {
      for (const [id] of battle.players) {
        this.playerBattle.delete(id);
      }
      this.battles.delete(battleId);
    }, 5000);
  }

  getPlayerBattleId(socketId) {
    return this.playerBattle.get(socketId) || null;
  }
}

// ─── Trade system ───

class TCGTradeManager {
  constructor() {
    this.trades = new Map();      // Map<tradeId, trade>
    this.playerTrade = new Map(); // Map<socketId, tradeId>
    this.nextId = 1;
  }

  propose(fromSocketId, toSocketId, fromName, offeredCards, requestedCards, offeredChips, requestedChips) {
    if (this.playerTrade.has(fromSocketId)) return { error: 'Already in a trade' };
    if (this.playerTrade.has(toSocketId)) return { error: 'Player is in a trade' };
    if (fromSocketId === toSocketId) return { error: 'Cannot trade with yourself' };

    const tradeId = 'TRD' + (this.nextId++);
    const trade = {
      id: tradeId,
      state: 'pending', // pending, accepted, completed, cancelled
      from: fromSocketId,
      fromName: fromName || 'Anon',
      to: toSocketId,
      offeredCards: offeredCards || [],   // array of { instanceId, cardId, card }
      requestedCards: requestedCards || [], // what they want from the other player
      offeredChips: Math.min(10000000, Math.max(0, Math.floor(offeredChips || 0))),
      requestedChips: Math.min(10000000, Math.max(0, Math.floor(requestedChips || 0))),
      createdAt: Date.now(),
    };

    this.trades.set(tradeId, trade);
    this.playerTrade.set(fromSocketId, tradeId);
    return trade;
  }

  accept(socketId) {
    const tradeId = this.playerTrade.get(socketId);
    // Also check if this is the target of a pending trade
    let trade = null;
    if (tradeId) {
      trade = this.trades.get(tradeId);
    } else {
      for (const [tid, t] of this.trades) {
        if (t.to === socketId && t.state === 'pending') {
          trade = t;
          break;
        }
      }
    }
    if (!trade || trade.state !== 'pending' || trade.to !== socketId) return null;
    trade.state = 'accepted';
    this.playerTrade.set(socketId, trade.id);
    return trade;
  }

  decline(socketId) {
    let trade = null;
    for (const [tid, t] of this.trades) {
      if (t.to === socketId && t.state === 'pending') {
        trade = t;
        break;
      }
    }
    if (!trade) return null;
    trade.state = 'cancelled';
    this.playerTrade.delete(trade.from);
    this.playerTrade.delete(trade.to);
    this.trades.delete(trade.id);
    return trade;
  }

  cancel(socketId) {
    const tradeId = this.playerTrade.get(socketId);
    if (!tradeId) return null;
    const trade = this.trades.get(tradeId);
    if (!trade) return null;
    trade.state = 'cancelled';
    this.playerTrade.delete(trade.from);
    this.playerTrade.delete(trade.to);
    this.trades.delete(trade.id);
    return trade;
  }

  completeTrade(tradeId) {
    const trade = this.trades.get(tradeId);
    if (!trade || trade.state !== 'accepted') return null;
    trade.state = 'completed';
    this.playerTrade.delete(trade.from);
    this.playerTrade.delete(trade.to);
    this.trades.delete(trade.id);
    return trade;
  }

  getPlayerTradeId(socketId) {
    return this.playerTrade.get(socketId) || null;
  }
}

// ─── Table system (lobby/matchmaking for TCG battles) ───

class TCGTableManager {
  constructor() {
    this.tables = new Map();       // Map<tableId, table>
    this.playerTable = new Map();  // Map<socketId, tableId>
    this.nextId = 1;
  }

  createTable(socketId, playerName, playerColor, cardCount, isPrivate) {
    // One table at a time per player
    if (this.playerTable.has(socketId)) return { error: 'Already at a table' };

    var tableId = 'TBL' + (this.nextId++);
    var table = {
      id: tableId,
      name: (playerName || 'Anon') + "'s Table",
      host: {
        socketId: socketId,
        name: playerName || 'Anon',
        color: playerColor || '#dcddde',
        cardCount: cardCount || 0,
        ready: false,
      },
      guest: null,
      spectators: [],
      isPrivate: !!isPrivate,
      createdAt: Date.now(),
      state: 'waiting', // waiting | ready | battling
    };

    this.tables.set(tableId, table);
    this.playerTable.set(socketId, tableId);
    return { table: table };
  }

  joinTable(socketId, tableId, playerName, playerColor, cardCount) {
    if (this.playerTable.has(socketId)) {
      // If already at this table, silently return it
      if (this.playerTable.get(socketId) === tableId) {
        return { table: this.tables.get(tableId) };
      }
      return { error: 'Already at a table' };
    }

    var table = this.tables.get(tableId);
    if (!table) return { error: 'Table not found' };
    if (table.state === 'battling') return { error: 'Table is already in a battle' };
    if (table.guest) return { error: 'Table is full' };
    if (table.host.socketId === socketId) return { error: 'Cannot join your own table' };

    table.guest = {
      socketId: socketId,
      name: playerName || 'Anon',
      color: playerColor || '#dcddde',
      cardCount: cardCount || 0,
      ready: false,
    };
    table.state = 'waiting';
    this.playerTable.set(socketId, tableId);
    return { table: table };
  }

  leaveTable(socketId) {
    var tableId = this.playerTable.get(socketId);
    if (!tableId) return null;

    var table = this.tables.get(tableId);
    if (!table) {
      this.playerTable.delete(socketId);
      return null;
    }

    // If battle in progress, don't allow leaving via table system (use surrender)
    if (table.state === 'battling') {
      this.playerTable.delete(socketId);
      // Check if both players left
      var otherPlayer = null;
      if (table.host && table.host.socketId === socketId) {
        otherPlayer = table.guest;
        table.host = null;
      } else if (table.guest && table.guest.socketId === socketId) {
        otherPlayer = table.host;
        table.guest = null;
      }
      if (!table.host && !table.guest) {
        this.tables.delete(tableId);
        return { table: table, removed: true };
      }
      return { table: table, removed: false };
    }

    if (table.host && table.host.socketId === socketId) {
      // Host leaving destroys the table
      this.playerTable.delete(socketId);
      if (table.guest) {
        this.playerTable.delete(table.guest.socketId);
      }
      this.tables.delete(tableId);
      return { table: table, removed: true, wasHost: true, guestSocketId: table.guest ? table.guest.socketId : null };
    } else if (table.guest && table.guest.socketId === socketId) {
      // Guest leaving opens the seat
      this.playerTable.delete(socketId);
      table.guest = null;
      table.state = 'waiting';
      // Reset host ready since opponent left
      table.host.ready = false;
      return { table: table, removed: false, wasHost: false };
    }

    // Not found as host or guest (spectator or stale reference)
    this.playerTable.delete(socketId);
    return { table: table, removed: false };
  }

  setReady(socketId) {
    var tableId = this.playerTable.get(socketId);
    if (!tableId) return null;

    var table = this.tables.get(tableId);
    if (!table) return null;
    if (table.state === 'battling') return null;
    if (!table.host || !table.guest) return null;

    // Toggle ready for the player
    if (table.host.socketId === socketId) {
      table.host.ready = !table.host.ready;
    } else if (table.guest.socketId === socketId) {
      table.guest.ready = !table.guest.ready;
    } else {
      return null;
    }

    var bothReady = table.host.ready && table.guest.ready;
    if (bothReady) {
      table.state = 'battling';
    }

    return { table: table, bothReady: bothReady };
  }

  getOpenTables() {
    var result = [];
    for (var entry of this.tables) {
      var table = entry[1];
      if (!table.isPrivate && table.state === 'waiting') {
        result.push(this._serializeTable(table));
      }
    }
    return result;
  }

  getTableForPlayer(socketId) {
    var tableId = this.playerTable.get(socketId);
    if (!tableId) return null;
    var table = this.tables.get(tableId);
    if (!table) return null;
    return this._serializeTable(table);
  }

  removePlayer(socketId) {
    return this.leaveTable(socketId);
  }

  getTable(tableId) {
    var table = this.tables.get(tableId);
    if (!table) return null;
    return this._serializeTable(table);
  }

  // Mark a table as battling (called externally when battle starts)
  setTableBattling(tableId) {
    var table = this.tables.get(tableId);
    if (table) table.state = 'battling';
  }

  // Reset table after a battle ends (return to waiting state)
  resetTableAfterBattle(tableId) {
    var table = this.tables.get(tableId);
    if (!table) return;
    table.state = 'waiting';
    if (table.host) table.host.ready = false;
    if (table.guest) table.guest.ready = false;
  }

  // Clean up: remove table entirely
  destroyTable(tableId) {
    var table = this.tables.get(tableId);
    if (!table) return;
    if (table.host) this.playerTable.delete(table.host.socketId);
    if (table.guest) this.playerTable.delete(table.guest.socketId);
    this.tables.delete(tableId);
  }

  _serializeTable(table) {
    return {
      id: table.id,
      name: table.name,
      host: table.host ? {
        socketId: table.host.socketId,
        name: table.host.name,
        color: table.host.color,
        cardCount: table.host.cardCount,
        ready: table.host.ready,
      } : null,
      guest: table.guest ? {
        socketId: table.guest.socketId,
        name: table.guest.name,
        color: table.guest.color,
        cardCount: table.guest.cardCount,
        ready: table.guest.ready,
      } : null,
      isPrivate: table.isPrivate,
      state: table.state,
      createdAt: table.createdAt,
    };
  }
}

// ─── Helpers ───

function getCardInfo(cardId) {
  return CARD_MAP.get(cardId) || null;
}

function getCardValue(cardId, isShiny) {
  const card = CARD_MAP.get(cardId);
  if (!card) return 0;
  var val = RARITIES[card.rarity].coinValue;
  if (isShiny) val *= 3;
  return val;
}

function getFullCatalog() {
  return CARDS.map(card => ({
    id: card.id, name: card.name, rarity: card.rarity, type: card.type,
    atk: card.atk, def: card.def, hp: card.hp, img: card.img,
    coinValue: RARITIES[card.rarity].coinValue,
    rarityColor: RARITIES[card.rarity].color,
  }));
}

module.exports = {
  RARITIES,
  CARDS,
  CARD_MAP,
  CARDS_BY_RARITY,
  PACK_TIERS,
  TYPE_CHART,
  getTypeMultiplier,
  openPack,
  openSpecialPack,
  rollCard,
  getCardInfo,
  getCardValue,
  getFullCatalog,
  TCGBattleManager,
  TCGTradeManager,
  TCGTableManager,
  MAX_DECK_SIZE,
};
