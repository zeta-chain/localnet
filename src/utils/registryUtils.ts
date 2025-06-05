let isRegisteringGateways = false;

export const setRegisteringGateways = (value: boolean) => {
  isRegisteringGateways = value;
};

export const isRegisteringGatewaysActive = (): boolean => {
  return isRegisteringGateways;
};
