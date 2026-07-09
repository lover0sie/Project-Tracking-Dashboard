export const PV_COMBINED_LINE_BALANCE = [
  {
    category: "PV2",
    models: ["UWD"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6B", "6A", "7", "12", "8B", "10W"] },

        { vessels: ["CONDENSER"], processes: ["6B", "6A", "7", "8B", "8C", "10", "12"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["11"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B", "14C"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["15"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["16"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"] },
    ]
  },
  {
    category: "PV2",
    models: ["MUWD"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6B", "6A", "7", "12", "8B"] },

        { vessels: ["CONDENSER"], processes: ["6B", "6A", "7", "8B", "8C", "10", "12"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14C", "11"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["15"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["16"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"] },


    ]
  },
  {
    category: "PV2",
    models: ["UAAST3", "UAASV3"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6B", "6A", "7", "12", "8B"] },

        { vessels: ["EVAPORATOR"], processes: ["14C", "11"] },

        { vessels: ["EVAPORATOR"], processes: ["14B"] },

        { vessels: ["EVAPORATOR"], processes: ["15"] },

        { vessels: ["EVAPORATOR"], processes: ["16"] },

        { vessels: ["EVAPORATOR"], processes: ["17"] },

        { vessels: ["EVAPORATOR"], processes: ["18,19"] }

    ]
  },
  {
    category: "PV1",
    models: ["HXE-TT", "HXE-M", "HXE-TG", "HXE-HT", "ZUWV", "ZUWS"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6", "7", "8", "10"] },

        { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["11"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"] },

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["15"] },

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["16"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"] },

        { vessels: ["OIL SEPARATOR", "ECONOMIZER"], processes: ["18,19"] }
    ]
  },
  {
    category: "PV1",
    models: ["ZUWY"],
    groups: [
      { vessels: ["EVAPORATOR"], processes: ["6", "7", "10"] },

      { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10"] },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["11"] },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"] },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"] },

      { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["15"] },

      { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["16"] },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"] },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"] },

      { vessels: ["OIL SEPARATOR", "ECONOMIZER"], processes: ["18,19"] },
    ]
  }
];
