import { ethers } from "ethers";

const iface = new ethers.utils.Interface([
  "function decimals()view returns(uint8)",
  "function symbol() view returns(string)",
]);
export async function getTokenInfo(
  address: string,
  provider: ethers.providers.BaseProvider
) {
  try {
    if (
      address === ethers.constants.AddressZero ||
      address.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    ) {
      // base token
      return { decimals: "18", symbol: "ETH" };
    }
    const contract = new ethers.Contract(address, iface, provider);
    const [decimals] = await Promise.all([contract.decimals()]);
    return { decimals };
  } catch (error) {
    console.log(address);
    throw error;
  }
}

export async function getTokensInfo(
  addresses: string[],
  provider: ethers.providers.BaseProvider
) {
  return Promise.all(
    addresses.map((address) => getTokenInfo(address, provider))
  );
}
