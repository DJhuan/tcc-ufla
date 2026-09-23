const ELEMENT_COLORS: Record<string, number> = {
  H: 0xffffff,
  C: 0x909090,
  N: 0x3050f8,
  O: 0xff0d0d,
  F: 0x90e050,
  CL: 0x1ff01f,
  BR: 0xa62929,
  I: 0x940094,
  P: 0xff8000,
  S: 0xffff30,
  B: 0xffb5b5,
  LI: 0xcc80ff,
  NA: 0xab5cf2,
  K: 0x8f40d4,
  CA: 0x3dff00,
  FE: 0xe06633,
};

const ELEMENT_RADII: Record<string, number> = {
  H: 0.25,
  C: 0.5,
  N: 0.5,
  O: 0.5,
  S: 0.6,
  P: 0.6,
};

/**
 * Raios Covalentes (em Ångströms) baseados em Cordero et al. (2008).
 * Utilizados para inferência de conectividade e ligações químicas.
 */

const COVALENT_RADII: Record<string, number> = {
  H: 0.31,
  HE: 0.28,
  LI: 1.28,
  BE: 0.96,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  NE: 0.58,
  NA: 1.66,
  MG: 1.41,
  AL: 1.21,
  SI: 1.11,
  P: 1.07,
  S: 1.05,
  CL: 1.02,
  AR: 1.06,
  K: 2.03,
  CA: 1.76,
  FE: 1.32,
  BR: 1.2,
  I: 1.39,
  DEFAULT: 0.75, // Fallback para elementos raros não listados
};

export { ELEMENT_COLORS, ELEMENT_RADII, COVALENT_RADII };
