/** Indian states with their GST state codes (first two digits of a GSTIN).
 *  Copied verbatim from the v1 implementation — the codes are statutory. */
export const STATES: ReadonlyArray<readonly [name: string, code: string]> = [
  ["Andhra Pradesh","37"],["Arunachal Pradesh","12"],["Assam","18"],["Bihar","10"],
  ["Chandigarh","04"],["Chhattisgarh","22"],["Delhi","07"],["Goa","30"],["Gujarat","24"],
  ["Haryana","06"],["Himachal Pradesh","02"],["Jammu & Kashmir","01"],["Jharkhand","20"],
  ["Karnataka","29"],["Kerala","32"],["Ladakh","38"],["Madhya Pradesh","23"],["Maharashtra","27"],
  ["Manipur","14"],["Meghalaya","17"],["Mizoram","15"],["Nagaland","13"],["Odisha","21"],
  ["Puducherry","34"],["Punjab","03"],["Rajasthan","08"],["Sikkim","11"],["Tamil Nadu","33"],
  ["Telangana","36"],["Tripura","16"],["Uttar Pradesh","09"],["Uttarakhand","05"],
  ["West Bengal","19"],["Outside India","96"],
];

export const STATE_NAMES: readonly string[] = STATES.map(([name]) => name);

export function stateNameForCode(code: string): string | null {
  return STATES.find(([, c]) => c === code)?.[0] ?? null;
}
