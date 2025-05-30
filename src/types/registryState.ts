export class RegistryState {
  private static instance: RegistryState;
  private _initComplete = false;

  private constructor() {}

  public static getInstance(): RegistryState {
    if (!RegistryState.instance) {
      RegistryState.instance = new RegistryState();
    }
    return RegistryState.instance;
  }

  public get initComplete(): boolean {
    return this._initComplete;
  }

  public setInitComplete(value: boolean): void {
    this._initComplete = value;
  }
}

export const getRegistryState = () => RegistryState.getInstance();
export const isRegistryInitComplete = () => getRegistryState().initComplete;
export const setRegistryInitComplete = (value: boolean) =>
  getRegistryState().setInitComplete(value);
