// Faux runner CP-SAT : simule un échec — message clair sur stderr, exit 1.
process.stderr.write('erreur simulée : pause flottante non supportée par le moteur CP-SAT\n');
process.exit(1);
