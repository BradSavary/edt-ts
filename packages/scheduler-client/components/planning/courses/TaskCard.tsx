'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const MAX_ROOMS = 2;

export interface TaskCardProps {
  code: string;
  type: string;
  name: string;
  duration: number;
  /** Enseignants affichés (alternatives déjà formatées avec ' | '). */
  teachers: string[];
  groups: string[];
  rooms: string[];
  isNeutralized?: boolean;
  isEnforced?: boolean;
  groupInfo?: { type: 'parallel' | 'sequential' } | null;
  /**
   * Clé de cours pour le drag sidebar préparation.
   * Positionne `data-course-key` sur la carte (sauf si neutralisé/imposé).
   * Positionne aussi `data-title` et `data-duration`.
   */
  courseKey?: string;
  /**
   * ID de tâche pour le drag sidebar analyse.
   * Positionne `data-task-id`, `data-title`, `data-duration`,
   * `data-teachers`, `data-groups`, `data-rooms`, `data-code`, `data-name`, `data-type`.
   */
  taskId?: string;
  /** Actions du menu contextuel / dropdown. */
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onToggleNeutralize?: () => void;
  neutralizeLabel?: string;
  /** Répartition automatique de l'Autonomie dans les créneaux libres. */
  onDistribute?: () => void;
  distributeLabel?: string;
  /**
   * Si `false`, désactive le drag (même si `taskId` est fourni) en omettant les
   * attributs `data-task-id`/`data-*` associés (voir `useNeutralizedDraggable`, qui
   * cible `[data-task-id]`) — utilisé pour empêcher de fragmenter à la main le
   * résidu d'un cours ordinaire déjà partiellement placé. Par défaut `true`.
   */
  dragEnabled?: boolean;
}

export default function TaskCard({
  code,
  type,
  name,
  duration,
  teachers,
  groups,
  rooms,
  isNeutralized = false,
  isEnforced = false,
  groupInfo,
  courseKey,
  taskId,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleNeutralize,
  neutralizeLabel = 'Neutraliser',
  onDistribute,
  distributeLabel = 'Répartir',
  dragEnabled = true,
}: TaskCardProps) {
  const teacherStr = teachers.join(', ');
  const groupsStr = groups.join(', ');
  const roomsStr =
    rooms.length > 0
      ? rooms.slice(0, MAX_ROOMS).join(', ') + (rooms.length > MAX_ROOMS ? ', …' : '')
      : '';

  const hasActions = !!(onEdit || onDuplicate || onDelete || onToggleNeutralize || onDistribute);
  const draggableTaskId = dragEnabled ? taskId : undefined;

  // Attributs drag : mode cours (préparation)
  const courseDataAttrs: Record<string, string | undefined> = courseKey
    ? {
        'data-course-key': !isNeutralized && !isEnforced ? courseKey : undefined,
        'data-title': `${code} ${type}`,
        'data-duration': String(duration),
      }
    : {};

  // Attributs drag : mode tâche neutralisée (analyse)
  const taskDataAttrs: Record<string, string> = draggableTaskId
    ? {
        'data-task-id': draggableTaskId,
        'data-title': `${code} ${type}`,
        'data-duration': String(duration),
        'data-teachers': JSON.stringify(teachers),
        'data-groups': JSON.stringify(groups),
        'data-rooms': JSON.stringify(rooms),
        'data-code': code,
        'data-name': name,
        'data-type': type,
      }
    : {};

  const cardClassName = `text-xs select-none transition-all ${
    isNeutralized
      ? 'opacity-50 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950 cursor-default'
      : isEnforced
        ? 'opacity-70 cursor-default border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950'
        : groupInfo
          ? 'cursor-grab active:cursor-grabbing border-violet-300 dark:border-violet-700 hover:border-violet-400 hover:shadow-sm'
          : draggableTaskId
            ? 'cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-sm'
            : taskId
              ? 'cursor-default'
              : 'cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-sm'
  }`;

  function MenuItems({
    Separator,
    Item,
  }: {
    Separator: React.ComponentType;
    Item: React.ComponentType<{
      onSelect?: () => void;
      variant?: 'default' | 'destructive';
      children: React.ReactNode;
    }>;
  }) {
    return (
      <>
        {onEdit && <Item onSelect={onEdit}>✏ Modifier</Item>}
        {onDuplicate && <Item onSelect={onDuplicate}>⧉ Dupliquer</Item>}
        {(onEdit || onDuplicate) && <Separator />}
        {onToggleNeutralize && (
          <Item onSelect={onToggleNeutralize}>⊘ {neutralizeLabel}</Item>
        )}
        {onDistribute && (
          <Item onSelect={onDistribute}>🔀 {distributeLabel}</Item>
        )}
        {onDelete && (
          <>
            <Separator />
            <Item onSelect={onDelete} variant="destructive">
              🗑 Supprimer
            </Item>
          </>
        )}
      </>
    );
  }

  const cardElement = (
    <Card {...courseDataAttrs} {...taskDataAttrs} className={cardClassName}>
      <CardContent className="">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-bold text-card-foreground truncate">
            {code}{' '}
            <span className="font-normal text-muted-foreground">{type}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {groupInfo && (
              <Badge
                variant="outline"
                className="text-[10px] px-1 py-0 border-violet-400 text-violet-600 dark:text-violet-400"
              >
                {groupInfo.type === 'parallel' ? '∥' : '→'}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {duration}min
            </Badge>
            {hasActions && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground text-sm px-1 leading-none"
                    title="Actions"
                  >
                    ⋯
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <MenuItems Separator={DropdownMenuSeparator} Item={DropdownMenuItem} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        <div className="truncate text-foreground/70 mb-0.5">{name}</div>
        {teacherStr && (
          <div className="truncate text-muted-foreground">{teacherStr}</div>
        )}
        {groupsStr && (
          <div className="truncate text-muted-foreground/70">{groupsStr}</div>
        )}
        {roomsStr ? (
          <div className="truncate text-muted-foreground/60 italic">{roomsStr}</div>
        ) : (
          <div className="truncate text-red-400/70 dark:text-red-500/70 italic text-[10px]">
            Pas de salle par défaut
          </div>
        )}
        {!teacherStr && (
          <div className="truncate text-red-400/70 dark:text-red-500/70 italic text-[10px]">
            Pas d&apos;enseignant par défaut
          </div>
        )}
        {isEnforced && (
          <div className="mt-1 text-green-600 dark:text-green-400 font-medium">📌 Imposé</div>
        )}
        {isNeutralized && (
          <div className="mt-1 text-orange-500 dark:text-orange-400 font-medium text-[10px]">
            ⊘ Neutralisée
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (hasActions) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{cardElement}</ContextMenuTrigger>
        <ContextMenuContent>
          <MenuItems Separator={ContextMenuSeparator} Item={ContextMenuItem} />
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return cardElement;
}
