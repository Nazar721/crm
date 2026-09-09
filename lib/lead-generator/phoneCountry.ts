const COUNTRY_MAP: [RegExp, string][] = [
  [/ukrain|україн|kiev|kyiv|київ|lviv|львів|odesa|odessa|одес|kharkiv|харків|dnipro|дніпро/i, 'UA'],
  [/poland|польщ|warsaw|варшав/i, 'PL'],
  [/germany|німечч|berlin|мюнхен|munich/i, 'DE'],
  [/united states|usa|u\.s\.a|сша|america|америк|new york|лос-анд|los angeles|chicago/i, 'US'],
  [/united kingdom|uk\b|britain|британ|london|лондон|england/i, 'GB'],
  [/france|франц|paris|париж/i, 'FR'],
  [/spain|іспан|madrid|мадрид|barcelona/i, 'ES'],
  [/italy|італ|rome|рим|milan/i, 'IT'],
  [/czech|чехії|prague|прага/i, 'CZ'],
  [/romania|румун|bucharest|букурещ/i, 'RO'],
  [/moldova|молдов|chisinau|кишин/i, 'MD'],
  [/belarus|білорус|minsk|мінськ/i, 'BY'],
  [/netherlands|нідерланд|amsterdam|амстердам/i, 'NL'],
  [/canada|канад|toronto|торонто/i, 'CA'],
  [/australia|австрал|sydney|сідней/i, 'AU'],
  [/turkey|туречч|istanbul|стамбул/i, 'TR'],
  [/switzerland|швейцар|zurich|цюрих/i, 'CH'],
  [/austria|австр|vienna|відень/i, 'AT'],
];

export function countryFromLocation(location: string): string | undefined {
  if (!location) return undefined;
  for (const [pattern, code] of COUNTRY_MAP) {
    if (pattern.test(location)) return code;
  }
  return undefined;
}
