using SPT.Reflection.Patching;
using EFT.InventoryLogic;
using EFT;
using Newtonsoft.Json;
using System.Reflection;
using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;

namespace RAID_REVIEW
{
    public class RAID_REVIEW_Player_OnItemAddedOrRemovedPatch : ModulePatch
    {
        // Buffer removes briefly to detect internal inventory moves (remove+add of same item)
        private static readonly ConcurrentDictionary<string, TrackingLootItem> _pendingRemoves = new ConcurrentDictionary<string, TrackingLootItem>();

        protected override MethodBase GetTargetMethod()
        {
            return typeof(Player).GetMethod("OnItemAddedOrRemoved", BindingFlags.Instance | BindingFlags.Public);
        }

        [PatchPostfix]
        private static void PatchPostFix(ref Player __instance, Item item, ItemAddress location, bool added)
        {
            if (__instance.Location == "hideout") return;

            try
            {
                bool isPackingMagazine = location.Container.ID == "cartridges";
                if (RAID_REVIEW.LootTracking.Value && !isPackingMagazine)
                {
                    var lootItem = new TrackingLootItem
                    {
                        sessionId = RAID_REVIEW.sessionId,
                        profileId = __instance.ProfileId,
                        time = RAID_REVIEW.stopwatch.ElapsedMilliseconds,
                        itemId = item.Id,
                        itemName = item.LocalizedShortName(),
                        qty = item.StackObjectsCount,
                        type = item.QuestItem ? "QUEST_ITEM" : "LOOT",
                        added = added
                    };

                    if (!added)
                    {
                        // Buffer the remove — if a matching add comes within 50ms, it's an internal move
                        _pendingRemoves[item.Id] = lootItem;
                        Task.Delay(50).ContinueWith(_ =>
                        {
                            if (_pendingRemoves.TryRemove(item.Id, out var pending))
                            {
                                Telemetry.Send("LOOT", JsonConvert.SerializeObject(pending));
                            }
                        });
                    }
                    else
                    {
                        // If there's a pending remove for this item, it's an internal move — skip both
                        if (_pendingRemoves.TryRemove(item.Id, out _))
                            return;

                        Telemetry.Send("LOOT", JsonConvert.SerializeObject(lootItem));
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.LogError($"{ex.Message}");
            }
        }
    }
}
