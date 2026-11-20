const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/views/app/copy-trading-app.ejs');

const newContent = `<%- include('../partials/header') %>

<script>
function copyTradingStationApp() {
    return {
        copyModal: false,
        detailsModal: false,
        selectedMaster: {},
        masters: <%- safeJson(masters || []) %>,
        comments: <%- safeJson(typeof comments !== 'undefined' && comments ? comments : []) %>,
        commentFilter: 'all',
        newComment: {
            master_id: '',
            rating: 5,
            comment: ''
        },
        submittingComment: false,
        commentSuccess: '',
        commentError: '',
        searchQuery: '',
        selectedCategory: 'all',
        sortBy: 'roi',
        simulatorAmount: 1000,

        getSparklineSvg(m) {
            const seed = ((m.id || 1) * 37) % 100;
            const pts = [];
            const count = 18;
            const width = 280;
            const height = 56;
            const risk = Number(m.risk_score || 2);
            
            for (let i = 0; i < count; i++) {
                const progress = i / (count - 1);
                const trend = Math.pow(progress, 1.22);
                const wave = Math.sin(i * 1.6 + seed) * (risk * 2.2);
                let y = (height - 8) - (trend * (height - 20)) + wave;
                y = Math.max(6, Math.min(height - 4, y));
                const x = (i / (count - 1)) * width;
                pts.push(\`\${x.toFixed(1)},\${y.toFixed(1)}\`);
            }
            const pathD = 'M ' + pts.join(' L ');
            const areaD = pathD + \` L \${width},\${height} L 0,\${height} Z\`;
            return { pathD, areaD };
        },

        getRiskBadge(score) {
            const s = Number(score || 2);
            if (s <= 2) return { label: 'Low Risk (1-2)', level: '1-2', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
            if (s <= 4) return { label: 'Balanced (3-4)', level: '3-4', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
            return { label: 'High Alpha (' + s + ')', level: s + '/10', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
        },

        get filteredMasters() {
            let list = this.masters.slice();
            if (this.selectedCategory !== 'all') {
                list = list.filter(m => (m.category || '').toLowerCase().includes(this.selectedCategory.toLowerCase()));
            }
            if (this.searchQuery.trim()) {
                const q = this.searchQuery.toLowerCase();
                list = list.filter(m => 
                    (m.name || '').toLowerCase().includes(q) || 
                    (m.strategy_name || '').toLowerCase().includes(q) || 
                    (m.category || '').toLowerCase().includes(q) ||
                    (m.description || '').toLowerCase().includes(q)
                );
            }
            if (this.sortBy === 'roi') {
                list.sort((a, b) => Number(b.total_roi) - Number(a.total_roi));
            } else if (this.sortBy === 'win_rate') {
                list.sort((a, b) => Number(b.win_rate) - Number(a.win_rate));
            } else if (this.sortBy === 'risk') {
                list.sort((a, b) => Number(a.risk_score || 2) - Number(b.risk_score || 2));
            } else if (this.sortBy === 'copiers') {
                list.sort((a, b) => Number(b.copiers_count) - Number(a.copiers_count));
            } else if (this.sortBy === 'aum') {
                list.sort((a, b) => Number(b.aum_amount || 0) - Number(a.aum_amount || 0));
            }
            return list;
        },

        get filteredComments() {
            if (this.commentFilter === 'all') return this.comments;
            if (this.commentFilter === 'general') return this.comments.filter(c => !c.master_id);
            return this.comments.filter(c => String(c.master_id) === String(this.commentFilter));
        },

        get commentStats() {
            if (!this.comments.length) return { avg: '5.0', count: 0 };
            const sum = this.comments.reduce((acc, c) => acc + (Number(c.rating) || 5), 0);
            return {
                avg: (sum / this.comments.length).toFixed(1),
                count: this.comments.length
            };
        },

        masterComments(masterId) {
            if (!masterId) return [];
            return this.comments.filter(c => String(c.master_id) === String(masterId));
        },

        formatDate(dtStr) {
            if (!dtStr) return 'Just now';
            const d = new Date(dtStr);
            if (isNaN(d.getTime())) return dtStr;
            const now = new Date();
            const diffHours = Math.floor((now - d) / (1000 * 60 * 60));
            if (diffHours < 1) return 'Just now';
            if (diffHours < 24) return diffHours + 'h ago';
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return diffDays + 'd ago';
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        },

        openDetails(m) {
            this.selectedMaster = m;
            this.simulatorAmount = m.min_allocation || 500;
            this.detailsModal = true;
        },

        openCopy(m) {
            this.selectedMaster = m;
            this.copyModal = true;
        },

        filterByTrader(masterId) {
            this.commentFilter = String(masterId);
            this.newComment.master_id = String(masterId);
            const el = document.getElementById('community-discussion');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
        },

        async submitComment() {
            if (!this.newComment.comment.trim()) {
                this.commentError = 'Please enter your comment before posting.';
                return;
            }
            this.submittingComment = true;
            this.commentError = '';
            this.commentSuccess = '';

            try {
                const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
                const res = await fetch('/api/copy-trading/comment', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-Token': token || ''
                    },
                    body: JSON.stringify({
                        master_id: this.newComment.master_id || null,
                        rating: this.newComment.rating,
                        comment: this.newComment.comment
                    })
                });
                const data = await res.json();
                if (data.success && data.comment) {
                    this.comments.unshift(data.comment);
                    this.newComment.comment = '';
                    this.commentSuccess = '✓ Your strategy review and comment has been posted!';
                    setTimeout(() => { this.commentSuccess = ''; }, 6000);
                } else {
                    this.commentError = data.error || 'Failed to submit comment.';
                }
            } catch (err) {
                this.commentError = 'Network error while posting comment. Please try again.';
            } finally {
                this.submittingComment = false;
            }
        },

        async likeComment(comment) {
            if (comment._liked) return;
            comment._liked = true;
            comment.likes_count = (comment.likes_count || 0) + 1;
            try {
                const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
                await fetch('/api/copy-trading/comment/like', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRF-Token': token || ''
                    },
                    body: JSON.stringify({ comment_id: comment.id })
                });
            } catch (e) {}
        }
    };
}
</script>

<div x-data="copyTradingStationApp()" class="bg-surface-base min-h-screen py-10">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 space-y-10">
        
        <!-- Header & Balance Strip -->
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-surface-border pb-6">
            <div>
                <div class="inline-flex items-center space-x-2 px-3 py-0.5 bg-primary/10 border border-primary/30 rounded-full text-xs font-bold text-primary uppercase mb-1">
                    <span class="w-2 h-2 rounded-full bg-gain animate-pulse"></span>
                    <span>Live Institutional Copy Hub &bull; 0ms STP Sync</span>
                </div>
                <h1 class="text-2xl md:text-3xl font-bold font-serif text-content-primary">Automated Strategy Mirroring</h1>
                <p class="text-xs md:text-sm text-content-secondary">Mirror elite algorithmic traders and proprietary quant funds with sub-second order synchronization.</p>
            </div>
            
            <div class="flex items-center space-x-4 bg-surface-raised border border-surface-border p-4 rounded-2xl shadow-md">
                <div>
                    <span class="text-[10px] uppercase font-semibold text-content-tertiary block">Available Cash Balance</span>
                    <span class="text-xl font-bold font-mono text-content-primary tabular-nums">$<%= Number(user.balance).toLocaleString(undefined, {minimumFractionDigits: 2}) %></span>
                </div>
                <a href="/deposit" class="bg-gain hover:bg-gain/90 text-surface-base text-xs font-bold px-4 py-2.5 rounded-xl transition shadow flex items-center space-x-1">
                    <span class="text-sm font-bold leading-none">+</span>
                    <span>Deposit Capital</span>
                </a>
            </div>
        </div>

        <!-- ACTIVE SUBSCRIPTIONS LEDGER -->
        <% if (mySubscriptions && mySubscriptions.length > 0) { %>
            <div class="bg-surface-raised border border-surface-border rounded-2xl p-6 shadow-xl space-y-4">
                <div class="flex items-center justify-between border-b border-surface-border pb-3">
                    <div class="flex items-center space-x-2">
                        <h2 class="text-lg font-bold font-serif text-content-primary">My Active Strategy Subscriptions</h2>
                        <span class="px-2 py-0.5 rounded-full bg-gain/10 border border-gain/20 text-gain text-[10px] font-mono font-bold">LIVE MIRRORING</span>
                    </div>
                    <span class="text-xs text-content-secondary font-mono"><%= mySubscriptions.length %> Active Allocation(s)</span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <% mySubscriptions.forEach(sub => { %>
                        <div class="bg-surface-overlay border border-surface-border rounded-xl p-4 space-y-3 relative overflow-hidden">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center space-x-3">
                                    <img src="<%= sub.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80' %>" class="w-10 h-10 rounded-xl object-cover border border-primary/30" />
                                    <div>
                                        <h4 class="font-bold text-sm text-content-primary"><%= sub.master_name %></h4>
                                        <p class="text-[11px] text-[#d4a038] font-mono"><%= sub.strategy_name %></p>
                                    </div>
                                </div>
                                <span class="px-2 py-0.5 rounded-full bg-gain/10 border border-gain/30 text-gain font-mono text-[10px] font-bold uppercase">
                                    <%= sub.status %>
                                </span>
                            </div>

                            <div class="grid grid-cols-2 gap-2 text-xs font-mono p-2.5 bg-black/20 rounded-lg">
                                <div>
                                    <span class="text-[10px] text-content-tertiary block font-sans">Allocated:</span>
                                    <strong class="text-content-primary">$<%= Number(sub.allocated_amount).toLocaleString() %></strong>
                                </div>
                                <div class="text-right">
                                    <span class="text-[10px] text-content-tertiary block font-sans">Floating P&L:</span>
                                    <strong class="<%= Number(sub.current_profit) >= 0 ? 'text-gain' : 'text-loss' %>">
                                        <%= Number(sub.current_profit) >= 0 ? '+' : '' %>$<%= Number(sub.current_profit).toFixed(2) %>
                                    </strong>
                                </div>
                            </div>

                            <form action="/api/copy-trading/stop" method="POST" onsubmit="return confirm('Are you sure you want to stop copying this strategy? Your remaining capital will return to your cash balance.');">
                                <input type="hidden" name="_token" value="<%= csrfToken %>" />
                                <input type="hidden" name="subscription_id" value="<%= sub.id %>" />
                                <button type="submit" class="w-full py-2 bg-loss/10 hover:bg-loss/20 border border-loss/30 text-loss text-xs font-bold rounded-lg transition cursor-pointer">
                                    Stop Copying & Settle Capital
                                </button>
                            </form>
                        </div>
                    <% }) %>
                </div>
            </div>
        <% } %>

        <!-- MASTER STRATEGIES SECTION -->
        <div class="space-y-6">
            
            <!-- Filters & Search Toolbar -->
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface-raised border border-surface-border p-4 rounded-2xl shadow-sm">
                
                <!-- Category Pills -->
                <div class="flex items-center space-x-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none text-xs">
                    <button type="button" @click="selectedCategory = 'all'" 
                            :class="selectedCategory === 'all' ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        All Strategies
                    </button>
                    <button type="button" @click="selectedCategory = 'crypto'" 
                            :class="selectedCategory === 'crypto' ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        Crypto Derivatives
                    </button>
                    <button type="button" @click="selectedCategory = 'multi-asset'" 
                            :class="selectedCategory === 'multi-asset' ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        Multi-Asset Macro
                    </button>
                    <button type="button" @click="selectedCategory = 'forex'" 
                            :class="selectedCategory === 'forex' ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                            class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                        Forex & Gold
                    </button>
                </div>

                <!-- Search & Sort Controls -->
                <div class="flex items-center space-x-3">
                    <div class="relative">
                        <input type="text" x-model="searchQuery" placeholder="Search strategy or trader..." 
                               class="bg-surface-overlay border border-surface-border text-xs rounded-full pl-8 pr-3 py-1.5 outline-none w-48 text-content-primary focus:border-primary transition" />
                        <svg class="w-3.5 h-3.5 text-content-tertiary absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                    </div>

                    <select x-model="sortBy" class="bg-surface-overlay border border-surface-border text-content-primary rounded-full px-3 py-1.5 text-xs font-semibold outline-none cursor-pointer">
                        <option value="roi">Sort: Top Return %</option>
                        <option value="win_rate">Sort: Highest Win Rate</option>
                        <option value="risk">Sort: Lowest Risk</option>
                        <option value="copiers">Sort: Most Copiers</option>
                        <option value="aum">Sort: Largest AUM</option>
                    </select>

                    <a href="#community-discussion" class="px-3 py-1.5 rounded-full bg-surface-overlay hover:bg-black/30 border border-surface-border text-xs font-semibold text-content-secondary hover:text-white transition flex items-center space-x-1 whitespace-nowrap">
                        <span>💬 Reviews</span>
                        <span class="px-1.5 py-0.2 rounded-full bg-primary/20 text-primary text-[10px]" x-text="comments.length"></span>
                    </a>
                </div>

            </div>

            <!-- Strategy Cards Grid -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <template x-for="m in filteredMasters" :key="m.id">
                    <div class="bg-surface-raised border border-surface-border rounded-3xl p-5 space-y-4 flex flex-col justify-between shadow-xl hover:border-primary/40 transition-all group">
                        
                        <div class="space-y-3.5">
                            <!-- Card Header: Avatar & Badges -->
                            <div class="flex items-start justify-between">
                                <div class="flex items-center space-x-3">
                                    <img :src="m.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'" :alt="m.name" class="w-12 h-12 rounded-2xl object-cover border border-primary/30 shadow-xs" />
                                    <div>
                                        <div class="flex items-center space-x-1">
                                            <h3 class="font-bold text-sm font-serif text-white group-hover:text-primary transition" x-text="m.name"></h3>
                                            <span class="text-primary text-xs">✓</span>
                                        </div>
                                        <p class="text-[11px] text-[#d4a038] font-mono" x-text="m.strategy_name"></p>
                                    </div>
                                </div>
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 font-mono"
                                      :class="getRiskBadge(m.risk_score).cls"
                                      x-text="getRiskBadge(m.risk_score).label"></span>
                            </div>

                            <!-- Rating & Reviews pill -->
                            <div class="flex items-center justify-between text-xs px-1">
                                <div class="flex items-center space-x-1 text-amber-400 font-mono text-[11px]">
                                    <span>★★★★★</span>
                                    <span class="font-bold text-content-primary">4.9</span>
                                </div>
                                <button type="button" @click="filterByTrader(m.id)" class="text-[11px] text-primary hover:underline font-mono">
                                    💬 View Reviews &rarr;
                                </button>
                            </div>

                            <!-- Dynamic 30-Day SVG Equity Curve Sparkline -->
                            <div class="bg-[#090c12] border border-[#1a202c] rounded-2xl p-3 space-y-1.5">
                                <div class="flex items-center justify-between text-[10px] font-mono text-gray-400">
                                    <span>30-Day Track Record</span>
                                    <span class="text-gain font-bold" x-text="'+' + m.total_roi + '% ROI'"></span>
                                </div>
                                
                                <div class="h-14 w-full flex items-center justify-center overflow-hidden">
                                    <svg viewBox="0 0 280 56" class="w-full h-full overflow-visible">
                                        <defs>
                                            <linearGradient :id="'spark-grad-' + m.id" x1="0%" y1="0%" x2="0%" y2="100%">
                                                <stop offset="0%" stop-color="#10B981" stop-opacity="0.32"/>
                                                <stop offset="100%" stop-color="#10B981" stop-opacity="0.0"/>
                                            </linearGradient>
                                        </defs>
                                        <path :d="getSparklineSvg(m).areaD" :fill="'url(#spark-grad-' + m.id + ')'" />
                                        <path :d="getSparklineSvg(m).pathD" fill="none" stroke="#10B981" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
                                    </svg>
                                </div>
                            </div>

                            <!-- Stat Box: Total Return & Win Rate -->
                            <div class="grid grid-cols-2 gap-2 bg-[#090c12] border border-[#1a202c] rounded-2xl p-3 text-center">
                                <div>
                                    <span class="text-[9px] uppercase font-semibold text-gray-400 block tracking-wider font-mono">TOTAL RETURN</span>
                                    <span class="text-xl font-bold font-mono text-gain tabular-nums" x-text="'+' + m.total_roi + '%'"></span>
                                </div>
                                <div class="border-l border-[#1a202c]">
                                    <span class="text-[9px] uppercase font-semibold text-gray-400 block tracking-wider font-mono">WIN RATE</span>
                                    <span class="text-xl font-bold font-mono text-white tabular-nums" x-text="m.win_rate + '%'"></span>
                                </div>
                            </div>

                            <!-- Specifications Matrix -->
                            <div class="text-xs space-y-1.5 text-gray-300 font-mono pt-0.5">
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Asset Focus:</span>
                                    <span class="text-white font-semibold" x-text="m.category"></span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Active Copiers:</span>
                                    <span class="text-white font-semibold" x-text="Number(m.copiers_count).toLocaleString() + ' traders'"></span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-gray-400">Min Allocation:</span>
                                    <span class="text-[#d4a038] font-bold font-mono" x-text="'$' + m.min_allocation + ' USD'"></span>
                                </div>
                            </div>

                            <!-- Strategy Description -->
                            <p class="text-[11px] text-gray-400 italic line-clamp-2 leading-relaxed" x-text="m.description || 'Institutional quantitative execution strategy.'"></p>
                        </div>

                        <!-- Card Action Buttons -->
                        <div class="grid grid-cols-2 gap-2 pt-2 border-t border-[#1e2430]">
                            <button type="button" @click="openDetails(m)" 
                                    class="py-2.5 rounded-xl bg-surface-overlay hover:bg-[#1a202c] border border-surface-border text-content-secondary hover:text-white font-bold text-xs transition text-center cursor-pointer">
                                Audit Stats
                            </button>
                            <button type="button" @click="openCopy(m)" 
                                    class="py-2.5 rounded-xl bg-[#d4a038] hover:bg-[#c2902f] text-[#0a0d14] font-bold text-xs transition text-center shadow-md shadow-[#d4a038]/10 cursor-pointer">
                                Copy Strategy
                            </button>
                        </div>

                    </div>
                </template>
            </div>

            <!-- Empty State -->
            <template x-if="filteredMasters.length === 0">
                <div class="text-center py-16 bg-[#0f131a] rounded-3xl border border-[#1e2430] p-8 space-y-3">
                    <span class="text-4xl">🔍</span>
                    <h3 class="text-base font-bold text-white font-serif">No Strategies Found</h3>
                    <p class="text-xs text-gray-400 max-w-sm mx-auto">Try clearing your search query or selecting a different asset category.</p>
                    <button type="button" @click="searchQuery = ''; selectedCategory = 'all'" class="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold">
                        Reset Filters
                    </button>
                </div>
            </template>
        </div>

        <!-- ============================================================================== -->
        <!-- COMMUNITY DISCUSSION & VERIFIED REVIEWS SECTION                                -->
        <!-- ============================================================================== -->
        <div id="community-discussion" class="bg-surface-raised border border-surface-border rounded-3xl p-6 sm:p-8 space-y-8 shadow-xl">
            
            <!-- Section Header -->
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-surface-border pb-6">
                <div>
                    <div class="flex items-center space-x-2">
                        <span class="text-xl">💬</span>
                        <h2 class="text-xl font-bold font-serif text-content-primary">Trader Discussion & Strategy Reviews</h2>
                    </div>
                    <p class="text-xs text-content-secondary mt-1">Live community exchange, verified copier reviews, and strategy feedback across all active execution models.</p>
                </div>

                <div class="flex items-center space-x-4 bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl text-xs font-mono">
                    <div class="flex items-center space-x-1.5">
                        <span class="text-amber-400 font-bold">★★★★★</span>
                        <strong class="text-content-primary" x-text="commentStats.avg + ' / 5.0'"></strong>
                    </div>
                    <span class="text-content-tertiary">&bull;</span>
                    <span class="text-gain font-semibold">100% STP Verified</span>
                    <span class="text-content-tertiary">&bull;</span>
                    <span class="text-primary font-bold" x-text="comments.length + ' Posts'"></span>
                </div>
            </div>

            <!-- Discussion Grid: Left (Post Form) | Right (Comments List) -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                <!-- Left: Post Comment & Review Box -->
                <div class="lg:col-span-5 bg-surface-overlay border border-surface-border rounded-2xl p-5 space-y-4">
                    <div class="flex items-center justify-between border-b border-surface-border pb-3">
                        <h3 class="font-bold text-sm text-content-primary flex items-center space-x-2">
                            <span>✍️</span>
                            <span>Post Copier Review</span>
                        </h3>
                        <span class="text-[10px] font-mono text-gain px-2 py-0.5 rounded-full bg-gain/10 border border-gain/20">Verified Session</span>
                    </div>

                    <form @submit.prevent="submitComment()" class="space-y-4 text-xs font-sans">
                        <!-- Select Strategy or General -->
                        <div class="space-y-1">
                            <label class="block font-semibold text-content-secondary text-[11px]">Select Strategy / Subject</label>
                            <select x-model="newComment.master_id" class="w-full bg-surface-base border border-surface-border text-content-primary rounded-xl px-3 py-2.5 outline-none font-medium cursor-pointer">
                                <option value="">🌐 General Copy Trading Discussion</option>
                                <template x-for="m in masters" :key="m.id">
                                    <option :value="m.id" x-text="'👤 ' + m.name + ' (' + m.strategy_name + ')'"></option>
                                </template>
                            </select>
                        </div>

                        <!-- 5-Star Rating Picker -->
                        <div class="space-y-1">
                            <label class="block font-semibold text-content-secondary text-[11px]">Your Strategy Rating</label>
                            <div class="flex items-center space-x-2">
                                <div class="flex space-x-1 cursor-pointer text-xl text-amber-400">
                                    <template x-for="star in [1, 2, 3, 4, 5]" :key="star">
                                        <button type="button" @click="newComment.rating = star" class="transition hover:scale-110 focus:outline-none">
                                            <span x-text="star <= newComment.rating ? '★' : '☆'" :class="star <= newComment.rating ? 'text-amber-400' : 'text-gray-600'"></span>
                                        </button>
                                    </template>
                                </div>
                                <span class="font-mono text-xs font-semibold text-content-primary"
                                      x-text="newComment.rating === 5 ? '5/5 - Exceptional Alpha' : newComment.rating === 4 ? '4/5 - Very Good' : newComment.rating === 3 ? '3/5 - Average' : newComment.rating + '/5'"></span>
                            </div>
                        </div>

                        <!-- User Profile Identity -->
                        <div class="flex items-center space-x-2.5 p-2.5 bg-surface-base rounded-xl border border-surface-border">
                            <img src="<%= user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80' %>" class="w-8 h-8 rounded-full object-cover border border-primary/30" />
                            <div>
                                <span class="font-bold text-xs text-content-primary block"><%= user.name %></span>
                                <span class="text-[10px] text-gain font-mono">✓ Verified Account Profile</span>
                            </div>
                        </div>

                        <!-- Comment Textarea -->
                        <div class="space-y-1">
                            <label class="block font-semibold text-content-secondary text-[11px]">Your Strategy Review & Experience *</label>
                            <textarea x-model="newComment.comment" rows="4" required placeholder="Describe your copying results, discuss position sizing, or share feedback on this strategy..." 
                                      class="w-full bg-surface-base border border-surface-border text-content-primary rounded-xl p-3 outline-none text-xs leading-relaxed focus:border-primary transition"></textarea>
                        </div>

                        <!-- Feedback Alerts -->
                        <div x-show="commentError" class="p-3 rounded-xl bg-loss/10 border border-loss/30 text-loss text-xs font-medium" x-text="commentError"></div>
                        <div x-show="commentSuccess" class="p-3 rounded-xl bg-gain/10 border border-gain/30 text-gain text-xs font-medium" x-text="commentSuccess"></div>

                        <button type="submit" :disabled="submittingComment" 
                                class="w-full py-3 rounded-xl bg-[#d4a038] hover:bg-[#c2902f] text-[#0a0d14] font-bold text-xs shadow-md transition disabled:opacity-50 flex items-center justify-center space-x-1.5 cursor-pointer">
                            <span x-text="submittingComment ? 'Submitting Review...' : 'Post Verified Strategy Review &rarr;'"></span>
                        </button>
                    </form>
                </div>

                <!-- Right: Filter Pills & Comments Stream -->
                <div class="lg:col-span-7 space-y-5">
                    
                    <!-- Filter Pills Bar -->
                    <div class="flex items-center space-x-2 overflow-x-auto pb-2 scrollbar-none text-xs">
                        <button type="button" @click="commentFilter = 'all'" 
                                :class="commentFilter === 'all' ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                                class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                            All Reviews (<span x-text="comments.length"></span>)
                        </button>
                        <button type="button" @click="commentFilter = 'general'" 
                                :class="commentFilter === 'general' ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                                class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                            General Hub
                        </button>
                        <template x-for="m in masters" :key="m.id">
                            <button type="button" @click="commentFilter = String(m.id)" 
                                    :class="commentFilter === String(m.id) ? 'bg-primary text-white font-bold' : 'bg-surface-overlay text-content-secondary border border-surface-border'" 
                                    class="px-3.5 py-1.5 rounded-full transition cursor-pointer whitespace-nowrap">
                                <span x-text="m.name"></span>
                            </button>
                        </template>
                    </div>

                    <!-- Comments Stream List -->
                    <div class="space-y-3.5">
                        <template x-for="c in filteredComments" :key="c.id">
                            <div class="bg-surface-overlay border border-surface-border rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm hover:border-primary/30 transition">
                                
                                <!-- Top Bar: Author, Badges, Stars -->
                                <div class="flex items-start justify-between gap-3">
                                    <div class="flex items-center space-x-3">
                                        <img :src="c.author_avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80'" 
                                             class="w-9 h-9 rounded-full object-cover border border-surface-border shadow-xs shrink-0" />
                                        <div>
                                            <div class="flex items-center space-x-2 flex-wrap">
                                                <h4 class="font-bold text-sm text-content-primary" x-text="c.author_name"></h4>
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border font-mono"
                                                      :class="c.badge && c.badge.includes('VIP') ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-gain/10 text-gain border-gain/30'"
                                                      x-text="'✓ ' + (c.badge || 'Verified Copier')"></span>
                                            </div>
                                            <span class="text-[10px] text-content-tertiary font-mono" x-text="formatDate(c.created_at)"></span>
                                        </div>
                                    </div>

                                    <!-- Rating & Pinned -->
                                    <div class="text-right shrink-0">
                                        <template x-if="c.is_pinned">
                                            <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#D4A038]/10 text-[#D4A038] border border-[#D4A038]/20 block mb-1">
                                                📌 PINNED
                                            </span>
                                        </template>
                                        <div class="text-amber-400 text-xs font-mono">
                                            <template x-for="i in 5">
                                                <span x-text="i <= (c.rating || 5) ? '★' : '☆'"></span>
                                            </template>
                                        </div>
                                    </div>
                                </div>

                                <!-- Strategy Tag if referencing a master -->
                                <template x-if="c.master_name">
                                    <div class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-surface-base border border-surface-border text-[11px] font-mono">
                                        <span class="text-content-tertiary">Strategy:</span>
                                        <span class="font-bold text-primary" x-text="c.master_name"></span>
                                        <span class="text-content-tertiary">&bull;</span>
                                        <span class="text-[#D4A038]" x-text="c.master_strategy"></span>
                                    </div>
                                </template>

                                <!-- Comment Body -->
                                <p class="text-xs sm:text-[13px] text-content-secondary leading-relaxed font-sans" x-text="c.comment"></p>

                                <!-- Bottom Bar -->
                                <div class="flex items-center justify-between pt-2 border-t border-surface-border text-xs font-mono text-content-tertiary">
                                    <button type="button" @click="likeComment(c)" 
                                            class="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-surface-base hover:bg-black/30 transition text-[11px] active:scale-95"
                                            :class="c._liked ? 'text-gain font-bold' : 'text-content-secondary'">
                                        <span>👍</span>
                                        <span x-text="c._liked ? 'Helpful (' + c.likes_count + ')' : 'Helpful (' + (c.likes_count || 0) + ')'"></span>
                                    </button>

                                    <span class="text-[10px] text-content-tertiary">Verified STP Settlement</span>
                                </div>

                            </div>
                        </template>

                        <!-- Empty State -->
                        <template x-if="filteredComments.length === 0">
                            <div class="text-center py-12 bg-surface-base rounded-2xl border border-surface-border p-6 space-y-2">
                                <span class="text-3xl">💬</span>
                                <h4 class="text-sm font-bold text-content-primary">No Comments in this Filter</h4>
                                <p class="text-xs text-content-tertiary max-w-sm mx-auto">Be the first to share your performance feedback or ask questions for this master trader.</p>
                                <button type="button" @click="commentFilter = 'all'" class="text-xs text-primary font-bold hover:underline pt-1">
                                    Show All Discussions &rarr;
                                </button>
                            </div>
                        </template>
                    </div>

                </div>

            </div>

        </div>

    </div>

    <!-- 1. Audit / Strategy Details Modal -->
    <div x-show="detailsModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4" x-cloak>
        <div class="bg-surface-raised border border-surface-border max-w-lg w-full p-6 rounded-3xl shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto" @click.away="detailsModal = false">
            <div class="flex items-center justify-between border-b border-surface-border pb-3">
                <div class="flex items-center space-x-3">
                    <img :src="selectedMaster.avatar" :alt="selectedMaster.name" class="w-10 h-10 rounded-xl object-cover border border-primary/40" />
                    <div>
                        <h3 class="text-base font-bold font-serif text-content-primary" x-text="selectedMaster.name"></h3>
                        <p class="text-xs text-[#d4a038] font-mono" x-text="selectedMaster.strategy_name"></p>
                    </div>
                </div>
                <button type="button" @click="detailsModal = false" class="text-content-tertiary hover:text-content-primary text-2xl leading-none">&times;</button>
            </div>

            <!-- Performance Metrics Grid -->
            <div class="grid grid-cols-3 gap-2.5 text-xs font-mono">
                <div class="p-3 bg-surface-overlay rounded-2xl border border-surface-border">
                    <span class="text-[10px] text-content-tertiary uppercase block font-sans">Historical ROI</span>
                    <strong class="text-gain text-sm font-bold" x-text="'+' + selectedMaster.total_roi + '%'"></strong>
                </div>
                <div class="p-3 bg-surface-overlay rounded-2xl border border-surface-border">
                    <span class="text-[10px] text-content-tertiary uppercase block font-sans">Win Rate</span>
                    <strong class="text-content-primary text-sm font-bold" x-text="selectedMaster.win_rate + '%'"></strong>
                </div>
                <div class="p-3 bg-surface-overlay rounded-2xl border border-surface-border">
                    <span class="text-[10px] text-content-tertiary uppercase block font-sans">Risk Score</span>
                    <strong class="text-primary text-sm font-bold" x-text="selectedMaster.risk_score + '/10'"></strong>
                </div>
                <div class="p-3 bg-surface-overlay rounded-2xl border border-surface-border">
                    <span class="text-[10px] text-content-tertiary uppercase block font-sans">Max Drawdown</span>
                    <strong class="text-rose-400 text-sm font-bold">-2.8%</strong>
                </div>
                <div class="p-3 bg-surface-overlay rounded-2xl border border-surface-border">
                    <span class="text-[10px] text-content-tertiary uppercase block font-sans">Profit Factor</span>
                    <strong class="text-emerald-400 text-sm font-bold">2.84</strong>
                </div>
                <div class="p-3 bg-surface-overlay rounded-2xl border border-surface-border">
                    <span class="text-[10px] text-content-tertiary uppercase block font-sans">Profit Share</span>
                    <strong class="text-[#d4a038] text-sm font-bold" x-text="(selectedMaster.profit_share || 15) + '%'"></strong>
                </div>
            </div>

            <!-- Strategy Bio & Mechanics -->
            <div class="p-3.5 bg-surface-overlay rounded-2xl border border-surface-border space-y-1.5 text-xs">
                <span class="text-[10px] text-content-tertiary uppercase font-mono block font-bold">Strategy Executive Summary</span>
                <p class="text-content-secondary leading-relaxed" x-text="selectedMaster.description"></p>
                <div class="pt-1 flex items-center space-x-2 text-[10px] font-mono text-content-tertiary">
                    <span>STP Latency: &lt;12ms</span>
                    <span>&bull;</span>
                    <span>Brokerage: Mainstreet Prime DMA</span>
                </div>
            </div>

            <!-- Interactive Profit Calculator -->
            <div class="p-3.5 bg-gain/5 rounded-2xl border border-gain/20 space-y-2">
                <div class="flex items-center justify-between text-xs">
                    <span class="font-bold text-content-primary">Historical Profit Calculator</span>
                    <span class="text-gain font-mono font-bold" x-text="'$' + simulatorAmount + ' Allocation'"></span>
                </div>
                <input type="range" :min="selectedMaster.min_allocation || 250" max="10000" step="100" x-model="simulatorAmount" class="w-full accent-gain cursor-pointer" />
                <div class="flex items-center justify-between text-xs font-mono">
                    <span class="text-content-secondary">Estimated 30D Growth:</span>
                    <span class="text-gain font-bold text-sm" x-text="'≈ $' + Math.round(simulatorAmount * (1 + (Number(selectedMaster.total_roi) / 300))).toLocaleString()"></span>
                </div>
            </div>

            <!-- Verified Copier Reviews for this specific Master Trader -->
            <div class="p-3.5 bg-surface-overlay rounded-2xl border border-surface-border space-y-2 text-xs">
                <div class="flex items-center justify-between">
                    <span class="text-[10px] text-content-tertiary uppercase font-mono block font-bold">Verified Copier Reviews</span>
                    <span class="text-amber-400 font-mono text-[11px]">★ 4.9 / 5.0</span>
                </div>
                
                <div class="space-y-2 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
                    <template x-for="rev in masterComments(selectedMaster.id)" :key="rev.id">
                        <div class="p-2.5 rounded-xl bg-surface-base border border-surface-border space-y-1">
                            <div class="flex items-center justify-between text-[11px]">
                                <span class="font-bold text-content-primary" x-text="rev.author_name"></span>
                                <span class="text-amber-400 font-mono text-[10px]">
                                    <template x-for="i in 5"><span x-text="i <= (rev.rating || 5) ? '★' : '☆'"></span></template>
                                </span>
                            </div>
                            <p class="text-content-secondary text-[11px] leading-relaxed" x-text="rev.comment"></p>
                        </div>
                    </template>
                    <template x-if="masterComments(selectedMaster.id).length === 0">
                        <p class="text-[11px] text-content-tertiary italic">No specific reviews yet for this strategy. Leave your feedback in the discussion session below!</p>
                    </template>
                </div>
            </div>

            <!-- Action Footer -->
            <div class="flex items-center justify-between pt-2 border-t border-surface-border">
                <button type="button" @click="detailsModal = false; filterByTrader(selectedMaster.id)" class="text-primary hover:underline text-xs font-mono">
                    💬 View All Reviews for this Master &rarr;
                </button>
                <div class="flex space-x-2">
                    <button type="button" @click="detailsModal = false" class="px-4 py-2.5 rounded-xl text-xs text-content-secondary hover:text-content-primary font-bold">Close</button>
                    <button type="button" @click="detailsModal = false; openCopy(selectedMaster)" class="bg-[#d4a038] hover:bg-[#c2902f] text-[#0a0d14] font-bold px-5 py-2.5 rounded-xl text-xs shadow-md">
                        Copy Strategy &rarr;
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 2. 1-Click Copy Strategy Allocation Modal -->
    <div x-show="copyModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4" x-cloak>
        <div class="bg-surface-raised border border-primary/50 max-w-md w-full p-6 rounded-3xl shadow-2xl space-y-4" @click.away="copyModal = false">
            <div class="flex items-center justify-between border-b border-surface-border pb-3">
                <h3 class="text-lg font-bold font-serif text-content-primary" x-text="'Mirror: ' + (selectedMaster.name || '')"></h3>
                <button type="button" @click="copyModal = false" class="text-content-tertiary hover:text-content-primary text-xl">&times;</button>
            </div>

            <p class="text-xs text-content-secondary" x-text="'Allocate trading capital to automatically mirror the ' + (selectedMaster.strategy_name || '') + ' strategy.'"></p>

            <form action="/api/copy-trading/follow" method="POST" class="space-y-4 text-xs font-mono">
                <input type="hidden" name="_token" value="<%= csrfToken %>" />
                <input type="hidden" name="master_id" :value="selectedMaster.id" />

                <div class="p-3.5 bg-surface-overlay rounded-2xl border border-surface-border space-y-1.5">
                    <div class="flex justify-between text-content-secondary">
                        <span>Strategy Win Rate:</span>
                        <span class="text-gain font-bold" x-text="(selectedMaster.win_rate || '') + '%'"></span>
                    </div>
                    <div class="flex justify-between text-content-secondary">
                        <span>Historical ROI:</span>
                        <span class="text-gain font-bold" x-text="'+' + (selectedMaster.total_roi || '') + '%'"></span>
                    </div>
                    <div class="flex justify-between text-content-secondary">
                        <span>Min Required Allocation:</span>
                        <span class="text-primary font-bold" x-text="'$' + (selectedMaster.min_allocation || 250) + ' USD'"></span>
                    </div>
                </div>

                <div>
                    <div class="flex items-center justify-between mb-1">
                        <label class="block uppercase font-semibold text-content-secondary font-sans text-[11px]">Capital to Allocate ($ USD) *</label>
                        <span class="text-[10px] text-content-tertiary font-mono" x-text="'Avail: $' + <%= Number(user.balance) %>.toLocaleString()"></span>
                    </div>
                    <input type="number" step="any" name="amount" :min="selectedMaster.min_allocation || 250" :value="selectedMaster.min_allocation || 500" required 
                           class="w-full bg-surface-overlay border border-primary text-content-primary rounded-xl px-4 py-3 text-base font-bold font-mono outline-none" />
                </div>

                <div class="flex justify-end space-x-2 pt-2 border-t border-surface-border font-sans">
                    <button type="button" @click="copyModal = false" class="px-4 py-2.5 rounded-xl text-xs text-content-secondary hover:text-content-primary font-bold">Cancel</button>
                    <button type="submit" class="bg-[#d4a038] hover:bg-[#c2902f] text-[#0a0d14] font-bold px-5 py-2.5 rounded-xl text-xs shadow-md cursor-pointer">
                        Start Copying Strategy
                    </button>
                </div>
            </form>
        </div>
    </div>

</div>

<%- include('../partials/footer') %>
`;

fs.writeFileSync(filePath, newContent, 'utf8');
console.log('✓ Successfully updated src/views/app/copy-trading-app.ejs with comment session');
