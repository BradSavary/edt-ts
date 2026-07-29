'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePlanningStore } from '@/store/usePlanningStore';
import { useProjectStore } from '@/store/useProjectStore';
import { getCoursesForWeek } from '@/lib/weekCourses';
import { formatStartTime } from '@/lib/calendar/calendarUtils';
import {
  relevantSourceCourseIds,
  matchCoursesForCopy,
  buildEnforcedCopyItems,
  buildGroupCopyItems,
  buildNewEnforcedMap,
  buildNeutralizedCopyItems,
} from '@/lib/copyWeekPrep';

type Step = 'pick-week' | 'enforced' | 'groups' | 'neutralized';

/**
 * Synthèse affichée en tête d'étape quand la semaine source a bien des éléments, mais qu'aucun
 * n'est copiable : sans elle l'écran est un cul-de-sac muet (toutes les cases désactivées, aucune
 * explication d'ensemble — il fallait lire ligne à ligne pour comprendre). Le détail par ligne
 * reste la source de vérité sur le *pourquoi*, qui peut différer d'un item à l'autre.
 */
function NothingCopiable({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed bg-muted/40 p-2 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Copie, sous réserve de faisabilité, la préparation (cours enforced + groupes + tâches
 * neutralisées) d'une semaine source vers la semaine actuellement ouverte (destination). Un
 * cours de S n'est copiable que s'il existe en D un cours "similaire" (`courseSimilarityKey` —
 * même code/type/durée/enseignant(s)/groupe(s), semaine exclue) ; un groupe n'est copiable que
 * si TOUS ses membres le sont. Les enforced sont appliqués d'abord, les groupes ensuite (un
 * groupe enforced a chacune de ses tâches enforced — le flux les traite donc de façon
 * transparente), les neutralisés en dernier.
 */
export function CopyWeekPrepModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('pick-week');
  const [sourceWeekInput, setSourceWeekInput] = useState('');
  const [sourceWeek, setSourceWeek] = useState<number | null>(null);
  const [selectedEnforcedIds, setSelectedEnforcedIds] = useState<Set<string>>(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedNeutralizedIds, setSelectedNeutralizedIds] = useState<Set<string>>(new Set());

  const destWeek = usePlanningStore((s) => s.selectedWeek);
  const destEnforcedMap = usePlanningStore((s) => s.manualEnforcedMap);
  const destTaskGroups = usePlanningStore((s) => s.taskGroups);
  const destUnplaced = usePlanningStore((s) => s.unplaced);
  const handleEnforceChange = usePlanningStore((s) => s.handleEnforceChange);
  const addTaskGroup = usePlanningStore((s) => s.addTaskGroup);
  const addCourseToGroup = usePlanningStore((s) => s.addCourseToGroup);
  const addPreNeutralized = usePlanningStore((s) => s.addPreNeutralized);

  const allCourses = useProjectStore((s) => s.allCourses);
  const weekSaves = useProjectStore((s) => s.weekSaves);

  const sourceSnapshot = sourceWeek !== null ? weekSaves[String(sourceWeek)] : undefined;

  const sourceCourses = useMemo(
    () => (sourceWeek !== null ? getCoursesForWeek(allCourses, weekSaves, sourceWeek) : []),
    [allCourses, weekSaves, sourceWeek],
  );
  const destCourses = useMemo(
    () => (destWeek !== null ? getCoursesForWeek(allCourses, weekSaves, destWeek) : []),
    [allCourses, weekSaves, destWeek],
  );

  const matches = useMemo(
    () => matchCoursesForCopy(relevantSourceCourseIds(sourceSnapshot), sourceCourses, destCourses),
    [sourceSnapshot, sourceCourses, destCourses],
  );
  const enforcedItems = useMemo(
    () => buildEnforcedCopyItems(sourceSnapshot, matches, destEnforcedMap, destCourses, sourceCourses),
    [sourceSnapshot, matches, destEnforcedMap, destCourses, sourceCourses],
  );
  const groupItems = useMemo(
    () => buildGroupCopyItems(sourceSnapshot, matches, destTaskGroups),
    [sourceSnapshot, matches, destTaskGroups],
  );
  // `user-pre` uniquement : un cours non placé par le moteur (`engine`) ou retiré du calendrier
  // (`user-post`) reste copiable, `addPreNeutralized` promouvant alors son entrée (cf. copyWeekPrep).
  const destPreNeutralizedIds = useMemo(
    () => new Set(destUnplaced.filter((u) => u.origin === 'user-pre').map((u) => u.taskId)),
    [destUnplaced],
  );
  const neutralizedItems = useMemo(
    () => buildNeutralizedCopyItems(sourceSnapshot, matches, destPreNeutralizedIds, sourceCourses),
    [sourceSnapshot, matches, destPreNeutralizedIds, sourceCourses],
  );

  // Présélectionne tout ce qui est copiable dès que la semaine source change — l'utilisateur
  // décoche ensuite ce qu'il ne veut pas, plutôt que de tout cocher à la main.
  useEffect(() => {
    if (sourceWeek === null) return;
    setSelectedEnforcedIds(new Set(enforcedItems.filter((i) => i.copiable).map((i) => i.sourceCourseId)));
    setSelectedGroupIds(new Set(groupItems.filter((g) => g.copiable).map((g) => g.sourceGroup.id)));
    setSelectedNeutralizedIds(new Set(neutralizedItems.filter((i) => i.copiable).map((i) => i.sourceCourseId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceWeek]);

  function resetAndClose(next: boolean) {
    setOpen(next);
    if (!next) {
      setStep('pick-week');
      setSourceWeekInput('');
      setSourceWeek(null);
      setSelectedEnforcedIds(new Set());
      setSelectedGroupIds(new Set());
      setSelectedNeutralizedIds(new Set());
    }
  }

  function handlePickWeek() {
    const n = parseInt(sourceWeekInput, 10);
    if (isNaN(n)) return;
    setSourceWeek(n);
    setStep('enforced');
  }

  function toggleEnforced(id: string) {
    setSelectedEnforcedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleNeutralized(id: string) {
    setSelectedNeutralizedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleApply() {
    const selectedEnforced = enforcedItems.filter((i) => i.copiable && selectedEnforcedIds.has(i.sourceCourseId));
    const selectedGroups = groupItems.filter((g) => g.copiable && selectedGroupIds.has(g.sourceGroup.id));
    const selectedNeutralized = neutralizedItems.filter(
      (i) => i.copiable && selectedNeutralizedIds.has(i.sourceCourseId),
    );

    // Enforced d'abord, groupes ensuite (un groupe enforced a chacune de ses tâches déjà
    // enforced individuellement — le flux les traite donc de façon transparente). L'ordre
    // relatif à la neutralisation est indifférent (les trois structures sont disjointes) ; elle
    // est placée en dernier pour suivre l'ordre des écrans.
    if (selectedEnforced.length > 0) {
      handleEnforceChange(buildNewEnforcedMap(destEnforcedMap, selectedEnforced));
    }
    for (const g of selectedGroups) {
      if (!g.memberDestIds) continue;
      const newGroupId = addTaskGroup(g.sourceGroup.type);
      for (const destId of g.memberDestIds) {
        addCourseToGroup(newGroupId, destId);
      }
    }
    const neutralizedIds = selectedNeutralized
      .map((i) => i.destCourseId)
      .filter((id): id is string => id !== null);
    if (neutralizedIds.length > 0) addPreNeutralized(neutralizedIds);

    resetAndClose(false);
  }

  const roomMismatches = enforcedItems.filter((i) => i.copiable && selectedEnforcedIds.has(i.sourceCourseId) && i.roomMismatch);

  // Liste non vide mais entièrement bloquée — cas qui rendait l'étape muette (cf. NothingCopiable).
  const noEnforcedCopiable = enforcedItems.length > 0 && !enforcedItems.some((i) => i.copiable);
  const noGroupCopiable = groupItems.length > 0 && !groupItems.some((g) => g.copiable);
  const noNeutralizedCopiable = neutralizedItems.length > 0 && !neutralizedItems.some((i) => i.copiable);

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px]"
          title="Copier la préparation d'une autre semaine"
          onClick={() => setOpen(true)}
        >
          <Copy className="size-3" />
          Copier
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Copier la préparation d&apos;une semaine</DialogTitle>
          {step === 'pick-week' && (
            <DialogDescription>
              Sélectionnez la semaine source. Seuls les cours enforced et les groupes ayant un
              cours similaire (même code, type, durée, enseignant et groupe) en semaine {destWeek ?? '?'} seront copiables.
            </DialogDescription>
          )}
          {step === 'enforced' && (
            <DialogDescription>
              Cours enforced de la semaine {sourceWeek} — cochez ceux à reprendre en semaine {destWeek}.
            </DialogDescription>
          )}
          {step === 'groups' && (
            <DialogDescription>
              Groupes de la semaine {sourceWeek} — cochez ceux à reformer en semaine {destWeek}.
            </DialogDescription>
          )}
          {step === 'neutralized' && (
            <DialogDescription>
              Tâches neutralisées de la semaine {sourceWeek} — cochez celles à neutraliser en semaine {destWeek}.
            </DialogDescription>
          )}
        </DialogHeader>

        {step === 'pick-week' && (
          <div className="space-y-1.5">
            <Label htmlFor="source-week-input">Semaine source</Label>
            <Input
              id="source-week-input"
              type="number"
              min={1}
              max={52}
              value={sourceWeekInput}
              onChange={(e) => setSourceWeekInput(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {step === 'enforced' && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {enforcedItems.length === 0 && (
              <p className="text-sm text-muted-foreground italic">Aucun cours enforced en semaine {sourceWeek}.</p>
            )}
            {noEnforcedCopiable && (
              <NothingCopiable>
                Aucun des {enforcedItems.length} cours enforced de la semaine {sourceWeek} n&apos;est copiable en
                semaine {destWeek} — le motif est indiqué sous chaque ligne.
              </NothingCopiable>
            )}
            {enforcedItems.map((item) => (
              <div key={item.sourceCourseId} className="flex items-start gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  checked={item.copiable && selectedEnforcedIds.has(item.sourceCourseId)}
                  disabled={!item.copiable}
                  onChange={() => toggleEnforced(item.sourceCourseId)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {item.sourceCourse.code} {item.sourceCourse.type} — {item.sourceCourse.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatStartTime(item.enforcedData.startTime)} ({item.sourceCourse.duration} min)
                  </p>
                  {!item.copiable && (
                    <p className="text-xs text-orange-600 mt-0.5">
                      {item.alreadyEnforcedInDest ? 'Déjà imposé en semaine ' + destWeek : 'Cours similaire non trouvé'}
                    </p>
                  )}
                  {item.copiable && item.roomMismatch && (
                    <p className="text-xs text-orange-600 mt-0.5">
                      ⚠ Salle imposée non répertoriée pour ce cours en semaine {destWeek} — sera imposée telle quelle.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {step === 'groups' && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {groupItems.length === 0 && (
              <p className="text-sm text-muted-foreground italic">Aucun groupe en semaine {sourceWeek}.</p>
            )}
            {noGroupCopiable && (
              <NothingCopiable>
                Aucun des {groupItems.length} groupes de la semaine {sourceWeek} n&apos;est copiable en
                semaine {destWeek} — le motif est indiqué sous chaque ligne.
              </NothingCopiable>
            )}
            {groupItems.map((item) => {
              const memberNames = item.sourceGroup.courseKeys
                .map((k) => sourceCourses.find((c) => c.id === k))
                .filter((c): c is NonNullable<typeof c> => Boolean(c))
                .map((c) => `${c.code} ${c.type}`)
                .join(', ');
              return (
                <div key={item.sourceGroup.id} className="flex items-start gap-2 rounded-md border p-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    checked={item.copiable && selectedGroupIds.has(item.sourceGroup.id)}
                    disabled={!item.copiable}
                    onChange={() => toggleGroup(item.sourceGroup.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      Groupe {item.sourceGroup.type === 'parallel' ? 'parallèle' : 'séquentiel'} ({item.sourceGroup.courseKeys.length} cours)
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{memberNames}</p>
                    {!item.copiable && (
                      <p className="text-xs text-orange-600 mt-0.5">
                        {item.alreadyGroupedInDest ? 'Déjà dans un groupe en semaine ' + destWeek : 'Cours similaires non trouvés'}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {step === 'neutralized' && (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
            {neutralizedItems.length === 0 && (
              <p className="text-sm text-muted-foreground italic">Aucune tâche neutralisée en semaine {sourceWeek}.</p>
            )}
            {noNeutralizedCopiable && (
              <NothingCopiable>
                Aucune des {neutralizedItems.length} tâches neutralisées de la semaine {sourceWeek} n&apos;est
                copiable en semaine {destWeek} — le motif est indiqué sous chaque ligne.
              </NothingCopiable>
            )}
            {neutralizedItems.map((item) => (
              <div key={item.sourceCourseId} className="flex items-start gap-2 rounded-md border p-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  checked={item.copiable && selectedNeutralizedIds.has(item.sourceCourseId)}
                  disabled={!item.copiable}
                  onChange={() => toggleNeutralized(item.sourceCourseId)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {item.sourceCourse.code} {item.sourceCourse.type} — {item.sourceCourse.name}
                  </p>
                  <p className="text-xs text-muted-foreground">{item.sourceCourse.duration} min</p>
                  {!item.copiable && (
                    <p className="text-xs text-orange-600 mt-0.5">
                      {item.alreadyNeutralizedInDest ? 'Déjà neutralisé en semaine ' + destWeek : 'Cours similaire non trouvé'}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {roomMismatches.length > 0 && (
              <p className="text-xs text-orange-600 italic pt-2">
                Rappel : {roomMismatches.length} cours enforced sélectionné(s) seront imposés avec une salle non
                répertoriée pour leur cours en semaine {destWeek}.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'pick-week' && (
            <>
              <Button type="button" variant="outline" onClick={() => resetAndClose(false)}>Annuler</Button>
              <Button type="button" onClick={handlePickWeek} disabled={sourceWeekInput === ''}>Suivant</Button>
            </>
          )}
          {/* `autoFocus` sur le bouton d'avancement de chaque étape : le changement d'étape démonte
              la branche précédente, donc le bouton qui portait le focus disparaît et celui-ci
              retombait sur le document (aucune case cochable quand tout est bloqué). */}
          {step === 'enforced' && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('pick-week')}>Retour</Button>
              <Button type="button" autoFocus onClick={() => setStep('groups')}>Suivant</Button>
            </>
          )}
          {step === 'groups' && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('enforced')}>Retour</Button>
              <Button type="button" autoFocus onClick={() => setStep('neutralized')}>Suivant</Button>
            </>
          )}
          {step === 'neutralized' && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep('groups')}>Retour</Button>
              <Button type="button" autoFocus onClick={handleApply}>Appliquer</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
