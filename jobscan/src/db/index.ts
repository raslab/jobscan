/**
 * DB entry point — picks SQLite (dev) or Postgres (docker/production)
 * based on whether DATABASE_URL is set in the environment.
 *
 * All exported functions are async so callers are uniform regardless of adapter.
 */

export type * from './sqlite'; // type-level re-export (same shape for both adapters)

import * as sqlite from './sqlite';
import * as pg from './pg';

const usePg = !!process.env['DATABASE_URL'];
const adapter = usePg ? pg : sqlite;

if (usePg) {
  console.log('[db] Using PostgreSQL adapter');
} else {
  console.log('[db] Using SQLite adapter (dev mode)');
}

export const initDb               = adapter.initDb;
export const getSources           = adapter.getSources;
export const getSourcesForSync    = adapter.getSourcesForSync;
export const getSourceById        = adapter.getSourceById;
export const insertSource         = adapter.insertSource;
export const deleteSource         = adapter.deleteSource;
export const updateSourceSync     = adapter.updateSourceSync;
export const insertJobIfNew              = adapter.insertJobIfNew;
export const insertJobListingRow         = adapter.insertJobListingRow;
export const updateJobDetails            = adapter.updateJobDetails;
export const getJobs              = adapter.getJobs;
export const getJobById           = adapter.getJobById;
export const getJobsBySyncId      = adapter.getJobsBySyncId;
export const getDistinctCompanies = adapter.getDistinctCompanies;
export const startSyncLog         = adapter.startSyncLog;
export const completeSyncLog      = adapter.completeSyncLog;
export const getLatestSyncLog     = adapter.getLatestSyncLog;
export const insertHtmlBackup     = adapter.insertHtmlBackup;
export const getExistingJobUrls          = adapter.getExistingJobUrls;
export const getJobsWithEmptyDescription = adapter.getJobsWithEmptyDescription;
export const updateJobDescription        = adapter.updateJobDescription;
export const getJobsPaginated     = adapter.getJobsPaginated;
export const getJobsCount         = adapter.getJobsCount;
export const getSourcesCount      = adapter.getSourcesCount;
export const getSourcesPaginated  = adapter.getSourcesPaginated;
export const getJobCounts         = adapter.getJobCounts;
export const getJobStats          = adapter.getJobStats;
export const getJobFilterOptions  = adapter.getJobFilterOptions;

// ─── CRM ──────────────────────────────────────────────────────────────────────
export const getCrmJobByJobId             = adapter.getCrmJobByJobId;
export const insertCrmJob                 = adapter.insertCrmJob;
export const getCrmJobsByBucket           = adapter.getCrmJobsByBucket;
export const getCrmJobWithDetails         = adapter.getCrmJobWithDetails;
export const updateCrmJobBucket           = adapter.updateCrmJobBucket;
export const updateCrmJobComment          = adapter.updateCrmJobComment;
export const updateCrmJobProcessingStatus = adapter.updateCrmJobProcessingStatus;
export const updateCrmJobTier             = adapter.updateCrmJobTier;
export const deleteCrmJob                 = adapter.deleteCrmJob;
export const getCrmBucketCounts           = adapter.getCrmBucketCounts;
export const getCrmBucketCountsFiltered   = adapter.getCrmBucketCountsFiltered;
export const getNextPendingCrmJob         = adapter.getNextPendingCrmJob;
export const resetProcessingJobs          = adapter.resetProcessingJobs;
export const resetErroredJobs             = adapter.resetErroredJobs;
export const getCrmJobsForSourceJob       = adapter.getCrmJobsForSourceJob;
export const getErroredCrmJobs            = adapter.getErroredCrmJobs;
export const getCrmStatusMap              = adapter.getCrmStatusMap;
export const insertCrmEvent               = adapter.insertCrmEvent;
export const getCrmEventsByJob            = adapter.getCrmEventsByJob;
export const getCrmFilters                = adapter.getCrmFilters;
export const getCrmFilterById             = adapter.getCrmFilterById;
export const insertCrmFilter              = adapter.insertCrmFilter;
export const updateCrmFilter              = adapter.updateCrmFilter;
export const deleteCrmFilter              = adapter.deleteCrmFilter;
export const reorderCrmFilters            = adapter.reorderCrmFilters;
export const getActiveCrmFilters          = adapter.getActiveCrmFilters;
export const deactivateCrmFiltersByType   = adapter.deactivateCrmFiltersByType;
export const getCrmSettings               = adapter.getCrmSettings;
export const getCrmSetting                = adapter.getCrmSetting;
export const setCrmSetting                = adapter.setCrmSetting;
export const getCrmJobsByBucketFiltered   = adapter.getCrmJobsByBucketFiltered;
export const getCrmFilterOptions          = adapter.getCrmFilterOptions;
export const getCrmFunnelAnalytics        = adapter.getCrmFunnelAnalytics;
