import stanford from './assets/schools/stanford.png';
import harvard from './assets/schools/harvard.png';
import ucl from './assets/schools/ucl.png';
import oxford from './assets/schools/oxford.png';
import cambridge from './assets/schools/cambridge.png';
import berkeley from './assets/schools/berkeley.png';
import columbia from './assets/schools/columbia.png';
import melbourne from './assets/schools/melbourne.png';
import northwestern from './assets/schools/northwestern.png';
import hku from './assets/schools/hku.png';
import sydney from './assets/schools/sydney.png';
import unsw from './assets/schools/unsw.png';

interface SchoolBrand { image: string; wide?: boolean; aliases: string[]; }
const brands: SchoolBrand[] = [
  { image: stanford, aliases: ['Stanford', 'Stanford University', '斯坦福', '斯坦福大学', '史丹佛大學'] },
  { image: harvard, aliases: ['Harvard', 'Harvard University', 'Harvard Graduate School of Education', '哈佛', '哈佛大学'] },
  { image: ucl, wide: true, aliases: ['UCL', 'University College London', '伦敦大学学院', '倫敦大學學院'] },
  { image: oxford, aliases: ['Oxford', 'University of Oxford', 'Oxford University', '牛津', '牛津大学'] },
  { image: cambridge, aliases: ['Cambridge', 'University of Cambridge', 'Cambridge University', '剑桥', '剑桥大学', '劍橋大學'] },
  { image: berkeley, aliases: ['Berkeley', 'UC Berkeley', 'University of California Berkeley', '加州大学伯克利分校', '伯克利'] },
  { image: columbia, aliases: ['Columbia', 'Columbia University', 'Columbia Teachers College', 'Teachers College Columbia University', '哥伦比亚大学', '哥伦比亚大学教育学院'] },
  { image: melbourne, aliases: ['University of Melbourne', 'The University of Melbourne', 'Melbourne', '墨尔本大学'] },
  { image: northwestern, aliases: ['Northwestern', 'Northwestern University', 'Northwestern SESP', 'Northwestern University SESP', '美国西北大学'] },
  { image: hku, aliases: ['HKU', 'University of Hong Kong', 'The University of Hong Kong', '香港大学', '香港大學'] },
  { image: sydney, aliases: ['University of Sydney', 'The University of Sydney', 'Sydney', '悉尼大学'] },
  { image: unsw, aliases: ['UNSW', 'UNSW Sydney', 'University of New South Wales', 'The University of New South Wales', '新南威尔士大学'] },
];
const normalize = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s.,'’()（）\-–—]/g, '');
const byName = new Map(brands.flatMap(brand => brand.aliases.map(alias => [normalize(alias), brand] as const)));

/** Exact recognized aliases only. Fictional and unrecognized schools retain their own initials. */
export function schoolBrand(name: string): Pick<SchoolBrand, 'image' | 'wide'> | undefined {
  return byName.get(normalize(name));
}

export const schoolSuggestions = brands.flatMap(b => b.aliases);
export function canonicalSchool(name: string, existing: Array<{ institution: string }>): string {
  const key = normalize(name), brand = byName.get(key);
  const previous = existing.find(p => normalize(p.institution) === key || (brand && byName.get(normalize(p.institution)) === brand));
  return previous?.institution || (brand ? brand.aliases.find(alias => alias.includes('University')) || brand.aliases[0] : name.trim());
}
