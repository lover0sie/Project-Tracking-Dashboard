export const MODEL_VESSEL_LIST = [
  { models: ["UAAST3", "UAASV3"], vesselType: ["EVAPORATOR"]},
  { models: ["HXE-TG", "HXE-TT", "HXE-M", "HXE-HT"], vesselType: ["EVAPORATOR" , "CONDENSER", "ECONOMIZER"]},
  { models: ["MUWD", "UWD"], vesselType: ["EVAPORATOR" , "CONDENSER"]},
  { models: ["ZUWV", "ZUWY", "ZUWS"], vesselType: ["EVAPORATOR" , "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"]},
  { models: ["HT"], vesselType: ["EVAPORATOR", "CONDENSER"] },
]

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
    models: ["HXE-TT", "HXE-M", "HXE-TG", "HXE-HT"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6", "7", "8", "10A"], DAIPLtime: 1060.0 },

        { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"], DAIPLtime: 1220.0 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"], DAIPLtime: 800.0 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"], DAIPLtime: 870.0},

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"], DAIPLtime: 804.0 },

        { vessels: ["EVAPORATOR", "CONDENSER", "ECONOMIZER"], processes: ["15"], DAIPLtime: 432.9},

        { vessels: ["EVAPORATOR", "CONDENSER", "ECONOMIZER"], processes: ["16"], DAIPLtime: 265.4 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"], DAIPLtime: 150.0},

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"], DAIPLtime: 589.5},

        { vessels: ["ECONOMIZER"], processes: ["18,19"], DAIPLtime: 212.4 }
    ]
  },

  {
    category: "PV1",
    models: ["ZUWS"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6", "7", "8", "10A"], },

        { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"], },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"], },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"], },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"], },

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["15"], },

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["16"], },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"],},

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"], },

        { vessels: ["OIL SEPARATOR", "ECONOMIZER"], processes: ["18,19"], }
    ]
  },

  {
    category: "PV1",
    models: ["ZUWV"],
    groups: [
        { vessels: ["EVAPORATOR"], processes: ["6", "7", "8", "10A"], DAIPLtime: 1340 },

        { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"], DAIPLtime: 1280 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"], DAIPLtime: 720 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"], DAIPLtime: 850 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"], DAIPLtime: 440 },

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["15"], DAIPLtime: 604.8},

        { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["16"], DAIPLtime: 350 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"], DAIPLtime: 240 },

        { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"], DAIPLtime: 648.7 },

        { vessels: ["OIL SEPARATOR", "ECONOMIZER"], processes: ["18,19"], DAIPLtime: 421.6 }
    ]
  },

  {
    category: "PV1",
    models: ["ZUWY"],
    groups: [
      { vessels: ["EVAPORATOR"], processes: ["6", "7", "10A"], DAIPLtime: 1340 },

      { vessels: ["CONDENSER"], processes: ["6", "7", "8", "10A"], DAIPLtime: 1280 },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["10B", "11"], DAIPLtime: 720 },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["12", "13"], DAIPLtime: 850 },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["14A", "14B"], DAIPLtime: 440 },

      { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["15"], DAIPLtime: 604.8},

      { vessels: ["EVAPORATOR", "CONDENSER", "OIL SEPARATOR", "ECONOMIZER"], processes: ["16"], DAIPLtime: 350 },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["17"], DAIPLtime: 240 },

      { vessels: ["EVAPORATOR", "CONDENSER"], processes: ["18,19"], DAIPLtime: 648.7 },

      { vessels: ["OIL SEPARATOR", "ECONOMIZER"], processes: ["18,19"], DAIPLtime: 421.6 }
    ]
  }
];

export const CHILLER_LINE_BALANCE = [
  {
    category: "CHILLER",
    models: ["ZUWV", "ZUWY"],
    groups: [
      { processes: ["PIPING SHOP"], DAIPLtime: 700 },

      { processes: ["STEEL PIPE SUB-ASSEMBLY (FITTING)"], DAIPLtime: 182.3 },

      { processes: ["STEEL PIPE SUB-ASSEMBLY (WELDING)"], DAIPLtime: 237.7 },

      { processes: ["A"], DAIPLtime: 348 },

      { processes: ["B"], DAIPLtime: 522 },

      { processes: ["C"], DAIPLtime: 366.5 },

      { processes: ["D"], DAIPLtime: 292.4 },

      { processes: ["E"], DAIPLtime: 491.1 },

      { processes: ["F"], DAIPLtime: 480 },

      { processes: ["G2"], DAIPLtime: 1220 },

      { processes: ["H1"], DAIPLtime: 94.4 },

      { processes: ["H2"], DAIPLtime: 59.7 },

      { processes: ["H3"], DAIPLtime: 95.9 }
    ]
  },

  {
    category: "CHILLER",
    models: ["HXE-TT", "HXE-M", "HXE-TG", "HXE-HT"],
    groups: [
      { processes: ["PIPING SHOP"], DAIPLtime: 300.0},

      { processes: ["STEEL PIPE SUB-ASSEMBLY (FITTING)"], DAIPLtime: 135.4 },

      { processes: ["STEEL PIPE SUB-ASSEMBLY (WELDING)"], DAIPLtime: 314.6 },

      { processes: ["A"], DAIPLtime: 120.0 },

      { processes: ["B"], DAIPLtime: 280.0 },

      { processes: ["C"], DAIPLtime: 262.1 },

      { processes: ["D"], DAIPLtime: 362.7 },

      { processes: ["E"], DAIPLtime: 125.2 },

      { processes: ["F"], DAIPLtime: 700.0 },

      { processes: ["G2"], DAIPLtime: 348.9 },

      { processes: ["H1"], DAIPLtime: 317.9 },

      { processes: ["H2"], DAIPLtime: 253.2 },

      { processes: ["H3"], DAIPLtime: 0 }
    ]
  }
];

export const PROCESS_BY_PV = {

   "EVAPORATOR": [
    "6A - Hole bevelling",
    "6B - Fitting flange and piping",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "9A - Distribution box assembly",
    "9B - Fitting and welding distribution box",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "14C - Shell body slotting",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

   "CONDENSER": [
    "6A - Hole bevelling",
    "6B - Fitting flange and piping",
    "7 - Connector welding",
    "8A - Internal plate assembly",
    "8B - Fitting internal plate",
    "8C - GMAW C&B",
    "10 - Tube support, bush fitting, and tube sheet fitting",
    "11 - Tubesheet welding",
    "12 - Bracket and attachment welding, copper tube brazing",
    "13 - Unit side plate and base welding",
    "14A - Tube slotting",
    "14B - Tube expansion",
    "14C - Shell body slotting",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "17 - Hydrostatic testing",
    "18, 19 - Primer painting (weld seam) and top coat painting"
  ],

  "OIL SEPARATOR":[
    "6 - Hole bevelling",
    "7 - Connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

  "ECONOMIZER":[
    "6 - Hole bevelling",
    "7 - Connector welding",
    "8, 9, 10, 11 - Internal plate, distribution box, tube support and bush fitting and welding",
    "12 - Bracket and attachment fitting and welding",
    "15 - Primer painting",
    "16 - Pneumatic testing",
    "19 - Top coat painting"
  ],

   "WATER COVER COND SIDE A AND B":[
    "6 - Hole bevelling",
    "7 - Connector welding",
  ],

  "WATER COVER EVAP SIDE A AND B":[
    "6 - Hole bevelling",
    "7 - Connector welding",
  ],
};

export const PROCESS_BY_CHILLER = {
   "AIR-COOLED": [
    "Piping shop",
    "A1 - Coil assembly (Fan assembly)",
    "A2 - Coil assembly (Fan wiring)",
    "B1 - High-side assembly (Partition coil assembly)",
    "B2 - High-side assembly (C-Channel assembly)",
    "B3 - High-side assembly (Compressor and penta post assembly)",
    "B4 - High-side assembly (Evaporator assembly)",
    "B5 - High-side assembly (Piping assembly)",
    "B6 - High-side assembly (Wiring base)",
    "C1 - Brazing assembly (Brazing base)",
    "C2 - Brazing assembly (Brazing coil)",
    "D1 - Final assembly (Hoist coil onto base)",
    "D2 - Final assembly (Final brazing)",
    "D3 - Final assembly (Accessories assembly)",
    "D4 - Final assembly (Preparation for wiring and terminal box)",
    "D5 - Final assembly (Wiring control box)",
    "D6 - Final assembly (Panel installation)",
    "D7 - Final assembly (Pipe insulation)",
    "G1 - Insulation preparation",
    "G2 - Piping insulation",
    "H1 - Checking item, wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ],

  "WATER-COOLED": [
    "Piping shop",
    "Steel pipe sub-assembly (Fitting)",
    "Steel pipe sub-assembly (Welding)",
    "C - Major components assembly",
    "D - Steel pipe welding",
    "E - Copper pipe brazing",
    "F - Control box and wiring",
    "G1 - Insulation preparation",
    "G2 - Piping insulation",
    "H1 - Checking item, wipe, sanding, polish, paste tape and plastic, and spray paint",
    "H2 - Remove tape and plastic, attach acrylic, organize wires, attach cap, and paste unit stickers",
    "H3 - Wrap the unit"
  ]
};
