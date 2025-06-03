let isRegisteringGateways = false;

export function setRegisteringGateways(value: boolean) {
  isRegisteringGateways = value;
}

export function isRegisteringGatewaysActive(): boolean {
  return isRegisteringGateways;
}
