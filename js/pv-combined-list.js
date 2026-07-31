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
        { vessels: ["EVAPORATOR"], processes: ["6", "7", "8", "10A"] },

        { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"] },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"] },

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
    models: ["ZUWV"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6", "7", "8", "10A"], plannedTime: 1340},

        { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"], plannedTime: 1280 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"], plannedTime: 720 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"], plannedTime: 850 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"], plannedTime: 440 },

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["15"], plannedTime: 514.2}, //30% of total process 15,18,19

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["16"], plannedTime: 254 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"], plannedTime: 336 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"], plannedTime: 623 },

        { vessels: ["OIL SEPARATOR", "ECONOMIZER"], processes: ["18,19"], plannedTime: 576.8666 }
    ]
  },
  {
    category: "PV1",
    models: ["ZUWY"],
    groups: [
      { vessels: ["EVAPORATOR"], processes: ["6", "7", "10A"] },

      { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"] },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"] },

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

export const CHILLER_LINE_BALANCE = [
  {
    category: "CHILLER",
    models: ["ZUWV"],
    groups: [
      { processes: ["PIPING SHOP"], plannedTime: 700 },

      { processes: ["STEEL PIPE SUB-ASSEMBLY (FITTING)"], plannedTime: 210 },

      { processes: ["STEEL PIPE SUB-ASSEMBLY (WELDING)"], plannedTime: 210 },

      { processes: ["A"], plannedTime: 348 },

      { processes: ["B"], plannedTime: 522 },

      { processes: ["C"], plannedTime: 345 }, // Need to check if this is correct for percentage

      { processes: ["D"], plannedTime: 345 }, // Need to check if this is correct for percentage

      { processes: ["E"], plannedTime: 460 }, // Need to check if this is correct for percentage

      { processes: ["F"], plannedTime: 480 },

      { processes: ["G"], plannedTime: 1220 },

      { processes: ["H1"], plannedTime: 100 },

      { processes: ["H2"], plannedTime: 100 },

      { processes: ["H3"], plannedTime: 50 }
    ]
  }
];
