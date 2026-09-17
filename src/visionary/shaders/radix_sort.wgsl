// GPU Radix Sort - deadlock-free implementation
// Replaces the original decoupled look-back (cross-workgroup spin-wait) with a 3-phase scatter:
//   Phase 1 (scatter_local): each workgroup computes local histogram + match/rank, writes reduction
//   Phase 2 (scatter_prefix_pass): a single-workgroup pass scans all partition reductions
//   Phase 3 (scatter_apply): each workgroup reads precomputed prefix, reorders and scatters globally

// Constants prepended by TypeScript before pipeline creation:
// const histogram_sg_size, histogram_wg_size, rs_radix_log2, rs_radix_size
// const rs_keyval_size, rs_histogram_block_rows, rs_scatter_block_rows
// const rs_mem_dwords, rs_mem_sweep_0_offset, rs_mem_sweep_1_offset, rs_mem_sweep_2_offset

struct GeneralInfo{
    keys_size: u32,
    padded_size: u32,
    passes: u32,       // reused to pass current radix pass index to scatter_prefix_pass
    even_pass: u32,
    odd_pass: u32,
};

@group(0) @binding(0)
var<storage, read_write> infos: GeneralInfo;
@group(0) @binding(1)
var<storage, read_write> histograms : array<atomic<u32>>;
@group(0) @binding(2)
var<storage, read_write> keys : array<u32>;
@group(0) @binding(3)
var<storage, read_write> keys_b : array<u32>;
@group(0) @binding(4)
var<storage, read_write> payload_a : array<u32>;
@group(0) @binding(5)
var<storage, read_write> payload_b : array<u32>;

// ============================================================================
// Buffer layout for histograms:
//   [0 .. keyval_size * radix_size)                                      -> global histograms
//   [keyval_size * radix_size .. (keyval_size + scatter_blocks_ru) * rs) -> per-workgroup reductions
//   [(keyval_size + scatter_blocks_ru) * rs .. (keyval_size + 2*scatter_blocks_ru) * rs) -> per-workgroup exclusive prefixes
// ============================================================================

// ============================================================================
// ZERO HISTOGRAMS
// ============================================================================
@compute @workgroup_size({histogram_wg_size})
fn zero_histograms(@builtin(global_invocation_id) gid : vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
    if gid.x == 0u {
        infos.even_pass = 0u;
        infos.odd_pass = 1u;
    }
    let scatter_wg_size_ = histogram_wg_size;
    let scatter_block_kvs = scatter_wg_size_ * rs_scatter_block_rows;
    // In indirect mode, nwg.x may be scatter_blocks_ru+1 due to safety addition.
    // Use max(nwg.x, scatter_blocks_ru) to ensure we zero enough space.
    let scatter_blocks_ru = (infos.keys_size + scatter_block_kvs - 1u) / scatter_block_kvs;
    let actual_wgs = max(nwg.x, scatter_blocks_ru);
    
    let histo_size = rs_radix_size;
    // Zero: histograms + partitions + prefix areas
    var n = (rs_keyval_size + actual_wgs * 2u) * histo_size;
    let b = n;
    if infos.keys_size < infos.padded_size {
        n += infos.padded_size - infos.keys_size;
    }
    
    let line_size = nwg.x * {histogram_wg_size}u;
    for (var cur_index = gid.x; cur_index < n; cur_index += line_size) {
        if cur_index >= n {
            return;
        }
        if cur_index < b {
            atomicStore(&histograms[cur_index], 0u);
        }
        else {
            keys[infos.keys_size + cur_index - b] = 0xFFFFFFFFu;
        }
    }
}

// ============================================================================
// CALCULATE HISTOGRAM
// ============================================================================
var<workgroup> smem : array<atomic<u32>, rs_radix_size>;
var<private> kv : array<u32, rs_histogram_block_rows>;

fn zero_smem(lid: u32) {
    if lid < rs_radix_size {
        atomicStore(&smem[lid], 0u);
    }
}

fn histogram_pass(pass_: u32, lid: u32) {
    zero_smem(lid);
    workgroupBarrier();
    
    for (var j = 0u; j < rs_histogram_block_rows; j++) {
        let u_val = bitcast<u32>(kv[j]);
        let digit = extractBits(u_val, pass_ * rs_radix_log2, rs_radix_log2);
        atomicAdd(&smem[digit], 1u);
    }
    
    workgroupBarrier();
    let histogram_offset = rs_radix_size * pass_ + lid;
    if lid < rs_radix_size && atomicLoad(&smem[lid]) >= 0u {
        atomicAdd(&histograms[histogram_offset], atomicLoad(&smem[lid]));
    }
}

fn fill_kv(wid: u32, lid: u32) {
    let rs_block_keyvals : u32 = rs_histogram_block_rows * histogram_wg_size;
    let kv_in_offset = wid * rs_block_keyvals + lid;
    for (var i = 0u; i < rs_histogram_block_rows; i++) {
        let pos = kv_in_offset + i * histogram_wg_size;
        kv[i] = keys[pos];
    }
}

@compute @workgroup_size({histogram_wg_size})
fn calculate_histogram(@builtin(workgroup_id) wid : vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>) {
    fill_kv(wid.x, lid.x);
    histogram_pass(3u, lid.x);
    histogram_pass(2u, lid.x);
    histogram_pass(1u, lid.x);
    histogram_pass(0u, lid.x);
}

// ============================================================================
// PREFIX SUM OVER HISTOGRAM (unchanged)
// ============================================================================
fn prefix_reduce_smem(lid: u32) {
    var offset = 1u;
    for (var d = rs_radix_size >> 1u; d > 0u; d = d >> 1u) {
        workgroupBarrier();
        if lid < d {
            let ai = offset * (2u * lid + 1u) - 1u;
            let bi = offset * (2u * lid + 2u) - 1u;
            atomicAdd(&smem[bi], atomicLoad(&smem[ai]));
        }
        offset = offset << 1u;
    }
    
    if lid == 0u { 
        atomicStore(&smem[rs_radix_size - 1u], 0u);
    }
        
    for (var d = 1u; d < rs_radix_size; d = d << 1u) {
        offset = offset >> 1u;
        workgroupBarrier();
        if lid < d {
            let ai = offset * (2u * lid + 1u) - 1u;
            let bi = offset * (2u * lid + 2u) - 1u;
            let t = atomicLoad(&smem[ai]);
            atomicStore(&smem[ai], atomicLoad(&smem[bi]));
            atomicAdd(&smem[bi], t);
        }
    }
}

@compute @workgroup_size({prefix_wg_size})
fn prefix_histogram(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid : vec3<u32>) {
    let histogram_base = (rs_keyval_size - 1u - wid.x) * rs_radix_size;
    let histogram_offset = histogram_base + lid.x;
    
    atomicStore(&smem[lid.x], atomicLoad(&histograms[histogram_offset]));
    atomicStore(&smem[lid.x + {prefix_wg_size}u], atomicLoad(&histograms[histogram_offset + {prefix_wg_size}u]));

    prefix_reduce_smem(lid.x);
    workgroupBarrier();
    
    atomicStore(&histograms[histogram_offset], atomicLoad(&smem[lid.x]));
    atomicStore(&histograms[histogram_offset + {prefix_wg_size}u], atomicLoad(&smem[lid.x + {prefix_wg_size}u]));
}

// ============================================================================
// SCATTER - 3-phase deadlock-free approach
// ============================================================================
var<workgroup> scatter_smem: array<u32, rs_mem_dwords>;
var<private> kr : array<u32, rs_scatter_block_rows>;
var<private> pv : array<u32, rs_scatter_block_rows>;

fn partitions_base_offset() -> u32 { return rs_keyval_size * rs_radix_size; }
fn prefix_base_offset(scatter_blocks_ru: u32) -> u32 { return (rs_keyval_size + scatter_blocks_ru) * rs_radix_size; }

fn histogram_load(digit: u32) -> u32 {
    return atomicLoad(&smem[digit]);
}

fn histogram_store(digit: u32, count: u32) { 
    atomicStore(&smem[digit], count);
}

fn fill_kv_even(wid: u32, lid: u32) {
    let subgroup_id = lid / histogram_sg_size;
    let subgroup_invoc_id = lid - subgroup_id * histogram_sg_size;
    let subgroup_keyvals = rs_scatter_block_rows * histogram_sg_size;
    let rs_block_keyvals : u32 = rs_histogram_block_rows * histogram_wg_size;
    let kv_in_offset = wid * rs_block_keyvals + subgroup_id * subgroup_keyvals + subgroup_invoc_id;
    for (var i = 0u; i < rs_histogram_block_rows; i++) {
        let pos = kv_in_offset + i * histogram_sg_size;
        kv[i] = keys[pos];
    }
    for (var i = 0u; i < rs_histogram_block_rows; i++) {
        let pos = kv_in_offset + i * histogram_sg_size;
        pv[i] = payload_a[pos];
    }
}

fn fill_kv_odd(wid: u32, lid: u32) {
    let subgroup_id = lid / histogram_sg_size;
    let subgroup_invoc_id = lid - subgroup_id * histogram_sg_size;
    let subgroup_keyvals = rs_scatter_block_rows * histogram_sg_size;
    let rs_block_keyvals : u32 = rs_histogram_block_rows * histogram_wg_size;
    let kv_in_offset = wid * rs_block_keyvals + subgroup_id * subgroup_keyvals + subgroup_invoc_id;
    for (var i = 0u; i < rs_histogram_block_rows; i++) {
        let pos = kv_in_offset + i * histogram_sg_size;
        kv[i] = keys_b[pos];
    }
    for (var i = 0u; i < rs_histogram_block_rows; i++) {
        let pos = kv_in_offset + i * histogram_sg_size;
        pv[i] = payload_b[pos];
    }
}

// Compute match/rank for all elements in kv[] using smem-based emulation
// IMPORTANT: workgroupBarrier() ensures deterministic results across separate dispatch calls
// (scatter_local and scatter_apply must produce identical kr[] values for correctness)
fn compute_match_rank(pass_: u32, lid_x: u32) {
    let subgroup_id = lid_x / histogram_sg_size;
    let subgroup_offset = subgroup_id * histogram_sg_size;
    let subgroup_tid = lid_x - subgroup_offset;

    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        let u_val = bitcast<u32>(kv[i]);
        let digit = extractBits(u_val, pass_ * rs_radix_log2, rs_radix_log2);
        atomicStore(&smem[lid_x], digit);
        workgroupBarrier();  // ensure all threads have written their digit before any reads
        var count = 0u;
        var rank = 0u;
        
        for (var j = 0u; j < histogram_sg_size; j++) {
            if atomicLoad(&smem[subgroup_offset + j]) == digit {
                count += 1u;
                if j <= subgroup_tid {
                    rank += 1u;
                }
            }
        }
        workgroupBarrier();  // ensure all reads complete before next iteration overwrites smem
        
        kr[i] = (count << 16u) | rank;
    }
}

// Accumulate workgroup-level histogram in smem from match/rank data
fn accumulate_wg_histogram(pass_: u32, lid_x: u32) {
    let subgroup_id = lid_x / histogram_sg_size;
    let subgroup_count = {scatter_wg_size}u / histogram_sg_size;

    zero_smem(lid_x);
    workgroupBarrier();

    for (var i = 0u; i < subgroup_count; i++) {
        if subgroup_id == i {
            for (var j = 0u; j < rs_scatter_block_rows; j++) {
                let v = bitcast<u32>(kv[j]);
                let digit = extractBits(v, pass_ * rs_radix_log2, rs_radix_log2);
                let prev = histogram_load(digit);
                let rank = kr[j] & 0xFFFFu;
                let count = kr[j] >> 16u;
                kr[j] = prev + rank;

                if rank == count {
                    histogram_store(digit, (prev + count));
                }
            }            
        }
        workgroupBarrier();
    }
}

// ---- PHASE 1: scatter_local ----
// Each workgroup computes local histogram and writes its per-digit reduction to the partitions area.
// No cross-workgroup communication at all.

@compute @workgroup_size({scatter_wg_size})
fn scatter_local_even(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
    if gid.x == 0u {
        infos.odd_pass = (infos.odd_pass + 1u) % 2u;
    }
    let cur_pass = infos.even_pass * 2u;
    
    fill_kv_even(wid.x, lid.x);
    compute_match_rank(cur_pass, lid.x);
    accumulate_wg_histogram(cur_pass, lid.x);

    // Write per-workgroup reduction
    let partition_base = partitions_base_offset() + wid.x * rs_radix_size;
    if lid.x < rs_radix_size {
        atomicStore(&histograms[partition_base + lid.x], histogram_load(lid.x));
    }
    
    // Pack pass index (low 16 bits) and workgroup count (high 16 bits) into infos.passes
    if gid.x == 0u {
        infos.passes = cur_pass | (nwg.x << 16u);
    }
}

@compute @workgroup_size({scatter_wg_size})
fn scatter_local_odd(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
    if gid.x == 0u {
        infos.even_pass = (infos.even_pass + 1u) % 2u;
    }
    let cur_pass = infos.odd_pass * 2u + 1u;

    fill_kv_odd(wid.x, lid.x);
    compute_match_rank(cur_pass, lid.x);
    accumulate_wg_histogram(cur_pass, lid.x);

    let partition_base = partitions_base_offset() + wid.x * rs_radix_size;
    if lid.x < rs_radix_size {
        atomicStore(&histograms[partition_base + lid.x], histogram_load(lid.x));
    }
    
    if gid.x == 0u {
        infos.passes = cur_pass | (nwg.x << 16u);
    }
}

// ---- PHASE 2: scatter_prefix_pass ----
// One workgroup of 256 threads; each thread handles one digit (0..255).
// Sequentially scans all workgroup reductions for that digit and computes exclusive prefix sums.
// Fully safe: no cross-workgroup dependencies within this pass.

@compute @workgroup_size({scatter_wg_size})
fn scatter_prefix_pass(@builtin(local_invocation_id) lid: vec3<u32>) {
    if lid.x >= rs_radix_size {
        return;
    }
    
    let digit = lid.x;
    // Unpack: low 16 bits = pass index, high 16 bits = actual workgroup count
    let packed = infos.passes;
    let pass_ = packed & 0xFFFFu;
    let num_wgs = packed >> 16u;
    
    let hist_offset = pass_ * rs_radix_size + digit;
    var running_sum = atomicLoad(&histograms[hist_offset]);
    
    let part_base = partitions_base_offset();
    let pref_base = prefix_base_offset(num_wgs);
    
    for (var wg = 0u; wg < num_wgs; wg++) {
        let part_idx = part_base + wg * rs_radix_size + digit;
        let pref_idx = pref_base + wg * rs_radix_size + digit;
        
        // Store exclusive prefix for this workgroup
        atomicStore(&histograms[pref_idx], running_sum);
        
        // Accumulate the reduction
        let red = atomicLoad(&histograms[part_idx]);
        running_sum += red;
    }
}

// ---- PHASE 3: scatter_apply ----
// Each workgroup re-reads its data, re-computes match/rank (cheap), reads its precomputed prefix,
// does local reorder through scatter_smem, and writes to global output.

fn scatter_apply_core(pass_: u32, lid: vec3<u32>, wid: vec3<u32>, nwg: vec3<u32>) {
    // Use nwg.x from the dispatch — same dispatch buffer as scatter_local, so same workgroup count
    let num_wgs = nwg.x;
    
    // Re-compute match/rank from the same data
    compute_match_rank(pass_, lid.x);
    
    // Read precomputed exclusive prefix for this workgroup into scatter_smem[0..255]
    let pref_base = prefix_base_offset(num_wgs);
    if lid.x < rs_radix_size {
        let pref_idx = pref_base + wid.x * rs_radix_size + lid.x;
        scatter_smem[lid.x] = atomicLoad(&histograms[pref_idx]);
    }
    workgroupBarrier();

    // Re-accumulate workgroup histogram in smem (needed for local prefix scan)
    let subgroup_id = lid.x / histogram_sg_size;
    let subgroup_count = {scatter_wg_size}u / histogram_sg_size;

    zero_smem(lid.x);
    workgroupBarrier();

    for (var i = 0u; i < subgroup_count; i++) {
        if subgroup_id == i {
            for (var j = 0u; j < rs_scatter_block_rows; j++) {
                let v = bitcast<u32>(kv[j]);
                let digit = extractBits(v, pass_ * rs_radix_log2, rs_radix_log2);
                let prev = histogram_load(digit);
                let rank = kr[j] & 0xFFFFu;
                let count = kr[j] >> 16u;
                kr[j] = prev + rank;

                if rank == count {
                    histogram_store(digit, (prev + count));
                }
            }
        }
        workgroupBarrier();
    }

    // Local prefix scan of workgroup histogram
    prefix_reduce_smem(lid.x);
    workgroupBarrier();

    // Convert rank to local index
    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        let v = bitcast<u32>(kv[i]);
        let digit = extractBits(v, pass_ * rs_radix_log2, rs_radix_log2);
        let exc = histogram_load(digit);
        let idx = exc + kr[i];
        kr[i] |= (idx << 16u);
    }
    workgroupBarrier();
    
    // Reorder through scatter_smem
    let smem_reorder_offset = rs_radix_size;
    let smem_base = smem_reorder_offset + lid.x;

    // Reorder keys
    for (var j = 0u; j < rs_scatter_block_rows; j++) {
        let smem_idx = smem_reorder_offset + (kr[j] >> 16u) - 1u;
        scatter_smem[smem_idx] = bitcast<u32>(kv[j]);
    }
    workgroupBarrier();
    for (var j = 0u; j < rs_scatter_block_rows; j++) {
        kv[j] = scatter_smem[smem_base + j * {scatter_wg_size}u];
    }
    workgroupBarrier();

    // Reorder payloads
    for (var j = 0u; j < rs_scatter_block_rows; j++) {
        let smem_idx = smem_reorder_offset + (kr[j] >> 16u) - 1u;
        scatter_smem[smem_idx] = pv[j];
    }
    workgroupBarrier();
    for (var j = 0u; j < rs_scatter_block_rows; j++) {
        pv[j] = scatter_smem[smem_base + j * {scatter_wg_size}u];
    }
    workgroupBarrier();

    // Reorder ranks
    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        let smem_idx = smem_reorder_offset + (kr[i] >> 16u) - 1u;
        scatter_smem[smem_idx] = kr[i];
    }
    workgroupBarrier();
    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        kr[i] = scatter_smem[smem_base + i * {scatter_wg_size}u] & 0xFFFFu;
    }
    
    // Convert local index to global index using precomputed exclusive prefix
    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        let v = bitcast<u32>(kv[i]);
        let digit = extractBits(v, pass_ * rs_radix_log2, rs_radix_log2);
        let exc = scatter_smem[digit];
        kr[i] += exc - 1u;
    }
}

@compute @workgroup_size({scatter_wg_size})
fn scatter_apply_even(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
    let cur_pass = infos.even_pass * 2u;
    
    fill_kv_even(wid.x, lid.x);
    scatter_apply_core(cur_pass, lid, wid, nwg);

    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        keys_b[kr[i]] = kv[i];
    }
    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        payload_b[kr[i]] = pv[i];
    }
}

@compute @workgroup_size({scatter_wg_size})
fn scatter_apply_odd(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {
    let cur_pass = infos.odd_pass * 2u + 1u;

    fill_kv_odd(wid.x, lid.x);
    scatter_apply_core(cur_pass, lid, wid, nwg);

    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        keys[kr[i]] = kv[i];
    }
    for (var i = 0u; i < rs_scatter_block_rows; i++) {
        payload_a[kr[i]] = pv[i];
    }
}
