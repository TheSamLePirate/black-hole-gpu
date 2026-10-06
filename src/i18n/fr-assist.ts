// French for the flight assistants (pilot.ts assist, the HUD's director, the graphs; keyed by the
// English: see src/i18n.ts).
export default {
  "Prediction unavailable: {0}": "Prédiction indisponible : {0}",
  "Wormhole prediction timed out": "Prédiction du trou de ver : délai dépassé",
  "Wormhole prediction replaced by a newer one": "Prédiction du trou de ver remplacée par une plus récente",
  "Planning dropped: the ship changed frames (the wormhole, or the scene's settings) — plan again":
    "Planification abandonnée : le vaisseau a changé de repère (le trou de ver, ou les réglages de la scène) — planifiez de nouveau",
  "Tunnel entrance": "Entrée du tunnel",
  "Tunnel centre": "Centre du tunnel",
  "Tunnel exit": "Sortie du tunnel",
  "End of the Dneg region": "Fin de la région Dneg",
  "In the tunnel · {0}%": "Dans le tunnel · {0} %",
  "Length: {0}": "Longueur : {0}",
  "Tunnel length": "Longueur du tunnel",
  "Near the wormhole": "Près du trou de ver",
  "Beyond the wormhole: the other universe": "Au-delà du trou de ver : l’autre univers",
  "Partial prediction: step limit reached": "Prédiction partielle : limite de calcul atteinte",
  "Partial prediction: invalid state encountered": "Prédiction partielle : état invalide rencontré",
  "Flight plan suspended: manoeuvres are unavailable inside the tunnel":
    "Plan de vol suspendu : les manœuvres sont indisponibles dans le tunnel",
  "Flight plan suspended: its manoeuvres belong to the other universe":
    "Plan de vol suspendu : ses manœuvres appartiennent à l’autre univers",
  "Clear of the wormhole region, {0} M from Gargantua": "Sortie de la région du trou de ver, à {0} M de Gargantua",
  "Autopilot: it flies, or it assists — you fly, its director on the HUD shows where to point, how much throttle":
    "Autopilote : il vole, ou il assiste — vous pilotez, son directeur dans le HUD montre où pointer, combien de poussée",
  "Assisted: you fly — the director (the ring) shows where to point, the throttle to set; F4: the autopilot flies":
    "Assisté : vous pilotez — le directeur (l'anneau) montre où pointer, la poussée à régler ; F4 : l'autopilote vole",
  "The autopilots fly again (F4: assisted)": "Les autopilotes volent de nouveau (F4 : assisté)",
  ASSISTED: "ASSISTÉ",
  AUTO: "AUTO",
  "WARP: HUB": "WARP : HUB",
  "WARP: YOU": "WARP : VOUS",
  "Warp managed by the hub": "Warp géré par le hub",
  "Warp managed by you — never above the hub's limit (, and .)": "Warp géré par vous — limité à la consigne du hub (, et .)",
  "Warp managed by the hub — click to control it below the hub's limit":
    "Warp géré par le hub — clic : vous le réglez dans la limite de sa consigne",
  "Warp managed by the hub — use WARP on its card to take control":
    "Warp géré par le hub — utilisez WARP sur sa carte pour prendre la main",
  "Assisted: you fly, the director shows its commands — click: the autopilot flies (F4)":
    "Assisté : vous pilotez, le directeur montre ses commandes — clic : l'autopilote vole (F4)",
  "The autopilot flies — click: you fly it, assisted (F4)": "L'autopilote vole — clic : vous pilotez, assisté (F4)",
  "TURN TO THE CUE": "TOURNEZ VERS LA CIBLE",
  "THROTTLE {0} %": "POUSSÉE {0} %",
  "CUT THE THROTTLE": "COUPEZ LA POUSSÉE",
  "{0} · ASSISTED": "{0} · ASSISTÉ",
  // ---- the alerts explained (ui/hud/alerts.ts)
  Why: "Pourquoi",
  "What to do": "Que faire",
  "The predicted path falls into Gargantua's horizon: beyond it nothing comes back, not even light.":
    "La trajectoire prévue tombe dans l'horizon de Gargantua : au-delà, rien ne revient, pas même la lumière.",
  "Burn now, prograde or radially out — the earlier, the cheaper; or let an autopilot hold the ship (8: hold position).":
    "Poussez maintenant, prograde ou radial sortant — plus tôt, moins cher ; ou laissez un autopilote tenir le vaisseau (8 : maintien de position).",
  "The predicted path meets the body's surface.": "La trajectoire prévue rencontre la surface du corps.",
  "Raise the periapsis (prograde at the apoapsis, or radially out); to come down on purpose: land (G) or entry and landing (⇧G).":
    "Remontez le périapside (prograde à l'apoapside, ou radial sortant) ; pour descendre exprès : atterrir (G) ou rentrée et atterrissage (⇧G).",
  "A limit was exceeded and a part failed: the load, or the heat on the shield or the hull.":
    "Une limite a été dépassée et une pièce a cédé : la charge, ou la chaleur sur le bouclier ou la coque.",
  "Ease off at once: less speed, less bank, the shield to the flow — then check what still works.":
    "Relâchez tout de suite : moins de vitesse, moins d'inclinaison, le bouclier face à l'écoulement — puis vérifiez ce qui marche encore.",
  "The heat shield nears its temperature limit: the flow heats it as the density times the cube of the speed.":
    "Le bouclier approche de sa température limite : l'écoulement le chauffe comme la densité fois le cube de la vitesse.",
  "Stay higher in thinner air (less bank: more lift up), keep the shield to the flow (angle of attack ~40°), or slow down.":
    "Restez plus haut dans un air plus fin (moins d'inclinaison : plus de portance vers le haut), gardez le bouclier face à l'écoulement (incidence ~40°), ou ralentissez.",
  "The hull's skin overheats where the shield does not shade it.": "La peau de la coque surchauffe là où le bouclier ne la protège pas.",
  "Turn the shield to the flow (the nose up), lower the speed, avoid steep dives.":
    "Tournez le bouclier vers l'écoulement (le nez haut), réduisez la vitesse, évitez les piqués.",
  "The acceleration nears what the structure bears.": "L'accélération approche de ce que la structure supporte.",
  "Ease the pull: less angle of attack, less bank, a gentler throttle.":
    "Relâchez : moins d'incidence, moins d'inclinaison, une poussée plus douce.",
  "The wing is past its stalling angle: its lift collapses.": "L'aile a dépassé son angle de décrochage : sa portance s'effondre.",
  "Lower the nose, add throttle, level the wings.": "Baissez le nez, remettez de la poussée, mettez les ailes à plat.",
  "At these speeds the shock ionises the air round the ship: the glow, the radio blackout.":
    "À ces vitesses le choc ionise l'air autour du vaisseau : la lueur, le silence radio.",
  "Expected during an entry: nothing to do but watch the heat and the load.":
    "Normal pendant une rentrée : rien à faire, sinon surveiller la chaleur et la charge.",
  "No propellant left: the main engine and the thrusters are out.": "Plus d'ergols : le moteur principal et les propulseurs sont éteints.",
  "Coast; an orbit lasts. Settings: the sci-fi antigravity, or place the ship (Place).":
    "Laissez-vous porter ; une orbite dure. Réglages : l'antigravité SF, ou placez le vaisseau (Placer).",
  "Less than a tenth of the propellant is left.": "Il reste moins d'un dixième des ergols.",
  "Check the Δv budget (the flight computer) before the next burn; burn where it pays most — fast, near the periapsis.":
    "Vérifiez le budget de Δv (l'ordinateur de vol) avant la prochaine poussée ; poussez là où c'est le plus rentable — vite, près du périapside.",
  "Inside the ergosphere space itself turns with the hole: nothing can stay still against the stars.":
    "Dans l'ergosphère, l'espace lui-même tourne avec le trou : rien ne peut rester immobile par rapport aux étoiles.",
  "No hovering here: orbit, or climb out radially.": "Pas de vol stationnaire ici : orbitez, ou remontez radialement.",
  "Below the photon orbit not even light can circle: any path here falls in or flies off.":
    "Sous l'orbite des photons, même la lumière ne peut tourner : toute trajectoire y tombe ou s'échappe.",
  "Climb out at once (radially out, full throttle).": "Remontez tout de suite (radial sortant, pleine poussée).",
  "Below the innermost stable circular orbit, a circle is unstable: a nudge spirals in.":
    "Sous la dernière orbite circulaire stable, un cercle est instable : une poussée minime fait spiraler vers l'intérieur.",
  "Climb above the ISCO before circularizing, or hold with thrust (8: hold position).":
    "Remontez au-dessus de l'ISCO avant de circulariser, ou tenez à la poussée (8 : maintien de position).",
  "Rolling on the ground.": "Roulage au sol.",
  "Keep straight; the brakes come once the nose wheel is down.": "Restez droit ; les freins viennent une fois la roue avant posée.",
  "Resting on the gear.": "Posé sur le train.",
  "U: take off to orbit — or Place the ship elsewhere.": "U : décoller vers l'orbite — ou Placer le vaisseau ailleurs.",
  "Time is held: the image refines, the ship waits.": "Le temps est suspendu : l'image s'affine, le vaisseau attend.",
  "Space: run the time.": "Espace : relancer le temps.",
  // C1: the burns flown by hand — the ignition counted down, the Δv left followed, the cutoff
  "from the node": "depuis le nœud",
  IGN: "ALLUM.",
  CUT: "COUP",
  "Orbit now": "Orbite actuelle",
  "Δv delivered — cut the engine": "Δv fourni — coupez le moteur",
  "Fold the graph": "Replier le graphe",
  "Show the graph": "Afficher le graphe",
  "CUT THE ENGINE": "COUPEZ LE MOTEUR",
  "Δv DELIVERED": "Δv FOURNI",
  "IGNITION IN {0}": "ALLUMAGE DANS {0}",
  "Δv LEFT {0}": "Δv RESTANT {0}",
  // C2: the take-off and the climb
  "Path angle": "Pente",
  "q · max": "q · max",
  Heading: "Cap",
  "Gravity turn in": "Virage grav. dans",
  "MECO in": "Coupure dans",
  Ascent: "Montée",
  Downrange: "Distance au sol",
  "GRAVITY TURN IN {0}": "VIRAGE GRAVITATIONNEL DANS {0}",
  "PATH {0}° · HDG {1}°": "PENTE {0}° · CAP {1}°",
  "MAX-Q {0} kPa": "MAX-Q {0} kPa",
  "MECO IN ~{0}": "COUPURE DANS ~{0}",
  // C3: the deorbit and the entry
  "Deorbit Δv left": "Δv de désorbitation restant",
  "from the burn": "depuis la poussée",
  "Entry corridor": "Couloir de rentrée",
  "ENTRY INTERFACE IN {0}": "INTERFACE DE RENTRÉE DANS {0}",
  "BANK {0}° {1}": "INCLINAISON {0}° {1}",
  RIGHT: "DROITE",
  LEFT: "GAUCHE",
  "REVERSAL IN ~{0}": "INVERSION DANS ~{0}",
  "Shield · load": "Bouclier · charge",
  "Reversal in": "Inversion dans",
  // C4: the final, hand-flown or the autopilot's
  "Final approach": "Approche finale",
  "FLARE IN {0}": "ARRONDI DANS {0}",
  "Flare in": "Arrondi dans",
  "on the final — hand-flown, its profile the autopilot's": "en finale — pilotée à la main, sur le profil de l'autopilote",
  // C5: the vertical descent and the hover
  "Vertical descent": "Descente verticale",
  "Descent rate": "Vitesse de descente",
  "DESCENT {0} → {1} m/s": "DESCENTE {0} → {1} m/s",
  DESCENT: "DESCENTE",
  "a descent on the engines — hand-flown, the landing autopilot's curve to follow":
    "une descente sur les moteurs — pilotée à la main, la courbe de l'autopilote d'atterrissage à suivre",
  "touchdown in ~{0}": "toucher dans ~{0}",
  // C6: the approach, the rendezvous, the target's orbit
  "Flies to the target and settles into a low circular orbit around it — the flight computer's Orbit the target":
    "Rejoint la cible et s'installe sur une orbite basse circulaire autour d'elle — le « Orbiter la cible » du calculateur de vol",
  Approach: "Approche",
  "CLOSING {0} → {1} m/s": "RAPPROCHEMENT {0} → {1} m/s",
  "BRAKE NOW": "FREINEZ",
  "BRAKE IN {0}": "FREINAGE DANS {0}",
  "Height held": "Altitude tenue",
  // C7: the docking
  "in along the port's axis, slowing as it nears": "le long de l'axe du port, en ralentissant à l'approche",
  "the last metres: on the axis, the ports facing — to the capture":
    "les derniers mètres : sur l'axe, les ports face à face — jusqu'à la capture",
  "held 10 m out until on the axis, the ports facing and the drift still":
    "tenu à 10 m tant qu'il n'est pas sur l'axe, les ports face à face et la dérive nulle",
  "to a point on the port's axis, off the target": "vers un point de l'axe du port, à l'écart de la cible",
  "round the target, clear of its hull, to the axis": "autour de la cible, à l'écart de sa coque, vers l'axe",
  "Along the axis": "Le long de l'axe",
  "CLOSE {0} → {1} m/s": "APPROCHE {0} → {1} m/s",
  "OFFSET {0} m · CONE {1} m": "ÉCART {0} m · CÔNE {1} m",
  "PORTS {0}°": "PORTS {0}°",
  "HOLD AT 10 m — ALIGN": "ATTENTE À 10 m — ALIGNEZ",
  "CONTACT IN ~{0}": "CONTACT DANS ~{0}",
  "Along · across": "Axe · travers",
  "in the corridor (cone {0} m)": "dans le couloir (cône de {0} m)",
  DOCK: "AMARRAGE",
  // C8: the graphs explained — what each shows, what to do out of its corridor
  "The height against the downrange: the take-off's optimum path, its corridor; the apoapsis and the height asked as levels":
    "L'altitude selon la distance au sol : la trajectoire optimale du décollage, son couloir ; l'apoapside et l'altitude visée en niveaux",
  "Downrange of the path — too shallow: pitch up to the path angle asked":
    "En aval de la trajectoire — trop à plat : cabrez jusqu'à la pente demandée",
  "Short of the path — too steep: pitch over to the path angle asked":
    "En amont de la trajectoire — trop raide : basculez jusqu'à la pente demandée",
  "The entry corridor: above it the lift cannot hold the fall's curve; below it the shield's heat or the load is too much. Dashed: the guidance's predicted fall":
    "Le couloir de rentrée : au-dessus, la portance ne tient plus la courbure de la chute ; en dessous, la chaleur du bouclier ou la charge sont trop fortes. En pointillé : la chute prédite par le guidage",
  "Too deep for the heat or the load: bank less — more of the lift up":
    "Trop bas pour la chaleur ou la charge : inclinez moins — plus de portance vers le haut",
  "Above the corridor again — a skip: bank more, less of the lift up":
    "De nouveau au-dessus du couloir — un rebond : inclinez davantage, moins de portance vers le haut",
  "The closing rate against the distance to the stand-off: the approach autopilot's braking curve, its corridor; slower is safe":
    "La vitesse de rapprochement selon la distance au point d'attente : la courbe de freinage de l'autopilote d'approche, son couloir ; plus lent est sûr",
  "Too fast to stop at the stand-off: brake now — full thrust against the closing":
    "Trop rapide pour s'arrêter au point d'attente : freinez maintenant — pleine poussée contre le rapprochement",
  "The closing rate against the distance along the port's axis: the docking autopilot's profile, its corridor":
    "La vitesse de rapprochement selon la distance le long de l'axe du port : le profil de l'autopilote d'amarrage, son couloir",
  "Too fast for the distance: brake along the axis — the thrusters back":
    "Trop rapide pour la distance : freinez le long de l'axe — les propulseurs vers l'arrière",
  "The Δv left against the time from the node: the burn centred on it, its corridor (started up to 15 % of its length early or late)":
    "Le Δv restant selon le temps depuis le nœud : la poussée centrée sur lui, son couloir (allumée jusqu'à 15 % de sa durée en avance ou en retard)",
  "Behind the burn: full throttle, the nose on the cue — and cut at the cue":
    "En retard sur la poussée : plein gaz, le nez sur l'anneau — et coupez à la consigne",
  "Ahead of the burn: ease the throttle — the burn is best centred on its node":
    "En avance sur la poussée : réduisez les gaz — elle est meilleure centrée sur son nœud",
  "The descent rate against the height: the landing autopilot's braking curve, its corridor; slower is safe":
    "La vitesse de descente selon l'altitude : la courbe de freinage de l'autopilote d'atterrissage, son couloir ; plus lent est sûr",
  "Too fast for the height: full throttle now — past this curve even a 90 % burn no longer stops in time":
    "Trop rapide pour l'altitude : plein gaz maintenant — au-delà de cette courbe, même une poussée à 90 % n'arrête plus à temps",
  "The final's height against the distance to the threshold: the landing profile, the PAPI's ±1° about it":
    "L'altitude de la finale selon la distance au seuil : le profil d'atterrissage, le ±1° du PAPI autour",
  "High on the profile (the PAPI white): steepen — the nose down, the air brake out":
    "Haut sur le profil (PAPI blanc) : plongez — le nez en bas, les aérofreins sortis",
  "Low on the profile (the PAPI red): shallow the descent — the nose up, or some thrust":
    "Bas sur le profil (PAPI rouge) : adoucissez la descente — le nez en haut, ou un peu de poussée",
  "Docks to a free port within 3 km — on the thrusters, to the port's axis, then in along it to the capture":
    "S'amarre à un port libre à moins de 3 km — aux propulseurs, vers l'axe du port, puis le long de celui-ci jusqu'à la capture",
} satisfies Record<string, string>;
