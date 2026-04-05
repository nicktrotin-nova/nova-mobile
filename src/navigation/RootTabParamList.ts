import type { NavigatorScreenParams } from "@react-navigation/native";
import type { MoreStackParamList } from "./MoreStack";

export type RootTabParamList = {
  MyDay: undefined;
  Wallet: undefined;
  Calendar: { prefillClientName?: string; prefillClientPhone?: string } | undefined;
  More: NavigatorScreenParams<MoreStackParamList>;
};
